#include <jni.h>
#include <android/log.h>
#include "llama.h"
#include "ggml-backend.h"
#include <atomic>
#include <algorithm>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <stdexcept>

namespace {
std::atomic<bool> cancelled{false};
std::atomic<int64_t> deadline{0};
llama_model *model = nullptr;
llama_context *context = nullptr;
std::once_flag initialized;
int64_t ms() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
bool abort_compute(void *) { return cancelled.load() || (deadline.load() > 0 && ms() >= deadline.load()); }
bool load_progress(float, void *) { return !abort_compute(nullptr); }
void fail(JNIEnv *env, const char *message) { env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message); }
void release() {
    if (context) { llama_free(context); context = nullptr; }
    if (model) { llama_model_free(model); model = nullptr; }
}
// Keep a token's trailing UTF-8 bytes until the next token completes the character.
size_t complete_prefix(const std::string &s) {
    size_t i = 0;
    while (i < s.size()) {
        unsigned char c = s[i];
        size_t n = c < 0x80 ? 1 : (c & 0xe0) == 0xc0 ? 2 : (c & 0xf0) == 0xe0 ? 3 : (c & 0xf8) == 0xf0 ? 4 : 1;
        if (i + n > s.size()) break;
        i += n;
    }
    return i;
}
void send(JNIEnv *env, jobject listener, jmethodID method, std::string &pending) {
    size_t n = complete_prefix(pending);
    if (!n) return;
    jbyteArray bytes = env->NewByteArray(static_cast<jsize>(n));
    if (!bytes) throw std::runtime_error("MEMORY");
    env->SetByteArrayRegion(bytes, 0, n, reinterpret_cast<const jbyte *>(pending.data()));
    env->CallVoidMethod(listener, method, bytes);
    env->DeleteLocalRef(bytes);
    pending.erase(0, n);
    if (env->ExceptionCheck()) throw std::runtime_error("CALLBACK");
}
const char *json_grammar = R"GBNF(
root ::= object
value ::= object | array | string | number | ("true" | "false" | "null") ws
object ::= "{" ws (string ":" ws value ("," ws string ":" ws value)*)? "}" ws
array ::= "[" ws (value ("," ws value)*)? "]" ws
string ::= "\"" ([^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4}))* "\"" ws
number ::= "-"? ([0-9] | [1-9] [0-9]{0,15}) ("." [0-9]+)? ([eE] [-+]? [0-9]+)? ws
ws ::= [ \t\n\r]{0,20}
)GBNF";
}

extern "C" JNIEXPORT void JNICALL Java_io_focusworkspace_app_ai_NativeEngine_init(JNIEnv *env, jclass, jstring directory) {
    const char *path = env->GetStringUTFChars(directory, nullptr);
    if (!path) return;
    std::string owned(path); env->ReleaseStringUTFChars(directory, path);
    std::call_once(initialized, [&] {
        llama_log_set([](ggml_log_level level, const char *text, void *) {
            if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) __android_log_write(ANDROID_LOG_WARN, "FocusAI", text);
        }, nullptr);
        ggml_backend_load_all_from_path(owned.c_str());
        llama_backend_init();
    });
}
extern "C" JNIEXPORT void JNICALL Java_io_focusworkspace_app_ai_NativeEngine_prepare(JNIEnv *, jclass) { cancelled = false; deadline = 0; }
extern "C" JNIEXPORT void JNICALL Java_io_focusworkspace_app_ai_NativeEngine_cancel(JNIEnv *, jclass) { cancelled = true; }
extern "C" JNIEXPORT void JNICALL Java_io_focusworkspace_app_ai_NativeEngine_unload(JNIEnv *, jclass) { release(); }
extern "C" JNIEXPORT void JNICALL Java_io_focusworkspace_app_ai_NativeEngine_load(JNIEnv *env, jclass, jstring filename) {
    release();
    const char *chars = env->GetStringUTFChars(filename, nullptr);
    if (!chars) return;
    std::string path(chars); env->ReleaseStringUTFChars(filename, chars);
    try {
        deadline = ms() + 120000;
        auto parameters = llama_model_default_params();
        parameters.n_gpu_layers = 0;
        parameters.load_mode = LLAMA_LOAD_MODE_MMAP;
        parameters.progress_callback = load_progress;
        model = llama_model_load_from_file(path.c_str(), parameters);
        if (!model) throw std::runtime_error(abort_compute(nullptr) ? "CANCELLED" : "LOAD_FAILED");
        auto cp = llama_context_default_params();
        cp.n_ctx = 4096; cp.n_batch = 256; cp.n_ubatch = 128; cp.n_seq_max = 1;
        cp.n_threads = 4; cp.n_threads_batch = 4;
        cp.offload_kqv = false; cp.op_offload = false;
        cp.abort_callback = abort_compute;
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
        context = llama_init_from_model(model, cp);
        if (!context) throw std::runtime_error("CONTEXT_FAILED");
        if (abort_compute(nullptr)) throw std::runtime_error("CANCELLED");
        deadline = 0;
    } catch (const std::exception &e) { release(); deadline = 0; fail(env, e.what()); }
}
extern "C" JNIEXPORT jlongArray JNICALL Java_io_focusworkspace_app_ai_NativeEngine_generate(
    JNIEnv *env, jclass, jbyteArray input, jint maxTokens, jboolean json, jobject listener) {
    if (!model || !context) { fail(env, "NOT_LOADED"); return nullptr; }
    int64_t start = ms(), first = 0;
    int generated = 0, prompt_count = 0;
    try {
        deadline = start + 120000;
        if (abort_compute(nullptr)) throw std::runtime_error("CANCELLED");
        jsize length = env->GetArrayLength(input);
        if (length <= 0 || length > 48000) throw std::runtime_error("INPUT_LIMIT");
        std::string prompt(length, '\0');
        env->GetByteArrayRegion(input, 0, length, reinterpret_cast<jbyte *>(prompt.data()));
        const llama_vocab *vocab = llama_model_get_vocab(model);
        prompt_count = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, true);
        const int limit = std::clamp(static_cast<int>(maxTokens), 1, 768);
        if (prompt_count <= 0 || prompt_count + limit > 4096) throw std::runtime_error("CONTEXT_LIMIT");
        std::vector<llama_token> tokens(prompt_count);
        if (llama_tokenize(vocab, prompt.data(), prompt.size(), tokens.data(), tokens.size(), true, true) < 0) throw std::runtime_error("TOKENIZE_FAILED");
        llama_memory_clear(llama_get_memory(context), true);
        for (int p = 0; p < prompt_count; p += 128) {
            if (abort_compute(nullptr)) break;
            auto batch = llama_batch_get_one(tokens.data() + p, std::min(128, prompt_count - p));
            int result = llama_decode(context, batch);
            if (result != 0 && !abort_compute(nullptr)) throw std::runtime_error("PREFILL_FAILED");
        }
        auto chain = llama_sampler_chain_init(llama_sampler_chain_default_params());
        std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(chain, llama_sampler_free);
        if (json) {
            auto grammar = llama_sampler_init_grammar(vocab, json_grammar, "root");
            if (!grammar) throw std::runtime_error("GRAMMAR_FAILED");
            llama_sampler_chain_add(chain, grammar);
        }
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(20));
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.8f, 1));
        llama_sampler_chain_add(chain, llama_sampler_init_temp(json ? 0.15f : 0.7f));
        llama_sampler_chain_add(chain, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
        jclass cls = env->GetObjectClass(listener);
        jmethodID method = env->GetMethodID(cls, "onTokenBytes", "([B)V");
        env->DeleteLocalRef(cls);
        if (!method) throw std::runtime_error("CALLBACK");
        std::string pending;
        for (int i = 0; i < limit && !abort_compute(nullptr); ++i) {
            llama_token next = llama_sampler_sample(chain, context, -1);
            if (llama_vocab_is_eog(vocab, next)) break;
            if (!first) first = ms();
            ++generated;
            char small[256];
            int n = llama_token_to_piece(vocab, next, small, sizeof(small), 0, false);
            if (n < 0) {
                std::vector<char> large(-n);
                n = llama_token_to_piece(vocab, next, large.data(), large.size(), 0, false);
                if (n > 0) pending.append(large.data(), n);
            } else pending.append(small, n);
            send(env, listener, method, pending);
            if (i + 1 < limit) {
                int result = llama_decode(context, llama_batch_get_one(&next, 1));
                if (result != 0 && !abort_compute(nullptr)) throw std::runtime_error("DECODE_FAILED");
            }
        }
        int64_t end = ms();
        jlong values[] = {first ? first - start : -1, generated, end - start, prompt_count,
            cancelled.load() ? 1L : 0L, end >= deadline.load() ? 1L : 0L,
            first ? std::max<int64_t>(1, end - first) : 0};
        deadline = 0;
        jlongArray array = env->NewLongArray(7);
        if (array) env->SetLongArrayRegion(array, 0, 7, values);
        return array;
    } catch (const std::exception &e) { deadline = 0; if (!env->ExceptionCheck()) fail(env, e.what()); return nullptr; }
}
