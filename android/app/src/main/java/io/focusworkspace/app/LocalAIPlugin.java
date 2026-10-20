package io.focusworkspace.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.focusworkspace.app.ai.NativeEngine;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/** App-private CPU inference: no server, network, storage permission, or task-store access. */
@CapacitorPlugin(name = "LocalAI")
public class LocalAIPlugin extends Plugin {
    private final Object lock = new Object();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancel = new AtomicBoolean();
    private final Map<String, JSONObject> catalog = new LinkedHashMap<>();
    private File directory;
    private SharedPreferences verified;
    private volatile boolean available, active = true, destroyed;
    private boolean busy, releaseQueued;
    private String phase = "initializing", error = "", requestId = "", loadedId = "";
    private int progress;
    private final Runnable idleRelease = this::queueRelease;

    @Override public void load() {
        directory = new File(getContext().getFilesDir(), "local-ai");
        directory.mkdirs();
        verified = getContext().getSharedPreferences("focus-ai-models", Context.MODE_PRIVATE);
        try (InputStream in = getContext().getAssets().open("public/ai-models.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] bytes = new byte[8192]; int n;
            while ((n = in.read(bytes)) != -1) out.write(bytes, 0, n);
            JSONArray models = new JSONObject(out.toString("UTF-8")).getJSONArray("models");
            for (int i = 0; i < models.length(); i++) {
                JSONObject m = models.getJSONObject(i); catalog.put(m.getString("id"), m);
            }
        } catch (Exception e) { phase = "unavailable"; error = "模型目录无法读取，请重新安装应用。"; return; }
        if (Build.VERSION.SDK_INT < 26 || !Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")) {
            phase = "unavailable"; error = "本地 AI 需要 Android 8 或更新版本的 64 位 ARM 手机。"; return;
        }
        worker.execute(() -> {
            try {
                NativeEngine.init(getContext().getApplicationInfo().nativeLibraryDir);
                available = true;
                synchronized (lock) { phase = "idle"; }
            } catch (Exception | LinkageError e) {
                synchronized (lock) { phase = "unavailable"; error = "本地推理组件无法启动，请检查安装包。"; }
            }
            publish();
        });
    }

    private File modelFile(String id) { return new File(directory, id + ".gguf"); }
    private JSONObject spec(String id) {
        JSONObject value = catalog.get(id);
        if (value == null) throw new IllegalArgumentException("请选择 4B 或 9B 模型。");
        return value;
    }
    private boolean isVerified(String id) {
        File file = modelFile(id); JSONObject model = spec(id);
        return file.isFile() && file.length() == model.optLong("bytes")
            && stamp(id).equals(verified.getString(id, ""));
    }
    private String stamp(String id) {
        File file = modelFile(id);
        return spec(id).optString("sha256") + ":" + file.length() + ":" + file.lastModified();
    }
    private JSObject status() {
        synchronized (lock) {
            JSObject result = new JSObject();
            result.put("available", available); result.put("phase", phase);
            result.put("busy", busy || releaseQueued); result.put("error", error);
            result.put("requestId", requestId); result.put("progress", progress);
            result.put("loadedModelId", loadedId); result.put("backend", "llama.cpp · CPU · 4 线程");
            JSArray models = new JSArray();
            for (String id : catalog.keySet()) {
                JSObject m = new JSObject(); m.put("id", id);
                m.put("installed", modelFile(id).isFile()); m.put("verified", isVerified(id));
                models.put(m);
            }
            result.put("models", models);
            return result;
        }
    }
    private void publish() {
        if (destroyed) return;
        JSObject current = status();
        main.post(() -> {
            if (destroyed || getActivity() == null) return;
            if (active && current.optBoolean("busy") && !current.optString("phase").equals("choosing"))
                getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        notifyListeners("aiStatus", current);
    }
    @PluginMethod public void getStatus(PluginCall call) { call.resolve(status()); }
    @PluginMethod public void openModelSource(PluginCall call) {
        try {
            JSONObject m = spec(call.getString("modelId", ""));
            String url = "https://huggingface.co/" + m.getString("repo") + "/blob/" + m.getString("revision") + "/" + m.getString("filename");
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (Exception e) { call.reject("无法打开浏览器，请从项目说明获取模型文件。"); }
    }


    private boolean begin(PluginCall call, String next) {
        synchronized (lock) {
            if (!available) { call.reject(error.isEmpty() ? "本地 AI 正在准备，请稍后重试。" : error, "UNAVAILABLE"); return false; }
            if (!active || destroyed) { call.reject("请回到应用前台重试。", "BACKGROUND"); return false; }
            if (busy || releaseQueued) { call.reject("请先停止当前操作。", "BUSY"); return false; }
            String id = call.getString("requestId", UUID.randomUUID().toString());
            if (!id.matches("[a-zA-Z0-9_-]{1,80}")) { call.reject("请求编号无效。", "INVALID"); return false; }
            busy = true; phase = next; progress = 0; error = ""; requestId = id;
            cancel.set(false); NativeEngine.prepare(); main.removeCallbacks(idleRelease);
        }
        publish(); return true;
    }
    private void finish() {
        synchronized (lock) { busy = false; requestId = ""; progress = 0; phase = releaseQueued ? "releasing" : loadedId.isEmpty() ? "idle" : "ready"; }
        publish(); scheduleIdle();
    }
    private void failed(PluginCall call, Throwable e) {
        boolean stopped = cancel.get() || "CANCELLED".equals(e.getMessage());
        String message = stopped ? "已停止操作。" : friendly(e);
        if (!stopped) synchronized (lock) { error = message; }
        call.reject(message, stopped ? "CANCELLED" : "AI_ERROR");
    }
    private String friendly(Throwable e) {
        String m = e.getMessage() == null ? "" : e.getMessage();
        switch (m) {
            case "CONTEXT_LIMIT": return "输入和任务上下文过长，请缩短问题或减少任务后重试。";
            case "LOAD_FAILED": case "CONTEXT_FAILED": return "模型加载失败。请关闭占用内存的应用，或切换 4B 重试。";
            case "INPUT_LIMIT": return "输入过长，请缩短后重试。";
            default: return e instanceof IllegalArgumentException || e instanceof IOException ? m : "本地推理失败，请释放模型后重新加载。";
        }
    }
    private void checkCancelled() throws IOException { if (cancel.get() || destroyed) throw new IOException("CANCELLED"); }
    private void updateProgress(int value) {
        synchronized (lock) { progress = Math.min(100, value); }
        publish();
    }
    private void verify(String id, File file, boolean checking) throws Exception {
        JSONObject m = spec(id);
        if (!file.isFile() || file.length() != m.getLong("bytes")) throw new IOException("模型大小不匹配，请导入指定的 Q4_K_M 文件。");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file), 1024 * 1024)) {
            byte[] buffer = new byte[1024 * 1024]; int n; long total = 0, last = 0;
            while ((n = in.read(buffer)) != -1) {
                checkCancelled(); digest.update(buffer, 0, n); total += n;
                if (checking && total - last > 64L * 1024 * 1024) { last = total; updateProgress((int)(total * 100 / file.length())); }
            }
        }
        StringBuilder actual = new StringBuilder();
        for (byte b : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", b & 255));
        if (!actual.toString().equals(m.getString("sha256"))) throw new IOException("模型校验未通过，请使用页面提供的固定版本文件。");
    }

    @PluginMethod public void importModel(PluginCall call) {
        try { spec(call.getString("modelId", "")); } catch (Exception e) { call.reject(e.getMessage()); return; }
        if (!begin(call, "choosing")) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
        try { startActivityForResult(call, intent, "importResult"); }
        catch (Exception e) { failed(call, e); finish(); }
    }
    @ActivityCallback private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) { cancel.set(true); finish(); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            cancel.set(true); call.reject("已取消导入。", "CANCELLED"); finish(); return;
        }
        Uri uri = result.getData().getData();
        String id = call.getString("modelId", "");
        synchronized (lock) { phase = "importing"; }
        publish();
        worker.execute(() -> {
            File temporary = new File(directory, id + ".gguf.part");
            try {
                long expected = spec(id).getLong("bytes");
                if (new StatFs(directory.getPath()).getAvailableBytes() < expected + 256L * 1024 * 1024) throw new IOException("手机可用空间不足，请至少预留模型大小加 256 MB。");
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new BufferedOutputStream(new FileOutputStream(temporary), 1024 * 1024)) {
                    if (in == null) throw new IOException("无法读取所选文件。");
                    byte[] buffer = new byte[1024 * 1024]; int n; long total = 0, last = 0;
                    while ((n = in.read(buffer)) != -1) {
                        checkCancelled(); total += n;
                        if (total > expected) throw new IOException("文件过大，请选择对应的 Q4_K_M 模型。");
                        hash.update(buffer, 0, n); out.write(buffer, 0, n);
                        if (total - last > 32L * 1024 * 1024) { last = total; updateProgress((int)(total * 100 / expected)); }
                    }
                    if (total != expected) throw new IOException("文件不完整或大小不匹配。");
                }
                StringBuilder digest = new StringBuilder();
                for (byte b : hash.digest()) digest.append(String.format(Locale.ROOT, "%02x", b & 255));
                if (!digest.toString().equals(spec(id).getString("sha256"))) throw new IOException("SHA-256 校验失败，请重新下载页面指定版本。");
                checkCancelled();
                Files.move(temporary.toPath(), modelFile(id).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                verified.edit().putString(id, stamp(id)).commit();
                call.resolve(status());
            } catch (Exception e) { failed(call, e); }
            finally { temporary.delete(); finish(); }
        });
    }

    @PluginMethod public void loadModel(PluginCall call) {
        String id = call.getString("modelId", "");
        try { spec(id); if (!modelFile(id).isFile()) throw new IOException("请先导入模型。"); }
        catch (Exception e) { call.reject(e.getMessage()); return; }
        if (!begin(call, "loading")) return;
        worker.execute(() -> {
            try {
                NativeEngine.unload(); synchronized (lock) { loadedId = ""; }
                if (!isVerified(id)) {
                    synchronized (lock) { phase = "verifying"; }
                    publish(); verify(id, modelFile(id), true);
                    verified.edit().putString(id, stamp(id)).commit();
                }
                checkCancelled();
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                ((ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
                if (memory.lowMemory || memory.availMem < modelFile(id).length() + 1024L * 1024 * 1024) throw new IOException("可用内存不足。请关闭其他应用，或改用 4B。");
                synchronized (lock) { phase = "loading"; progress = 0; } publish();
                NativeEngine.load(modelFile(id).getAbsolutePath()); checkCancelled();
                synchronized (lock) { loadedId = id; }
                call.resolve(status());
            } catch (Exception e) { NativeEngine.unload(); failed(call, e); }
            finally { finish(); }
        });
    }

    @PluginMethod public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt.isEmpty() || prompt.length() > 16000) { call.reject("请输入问题，并将上下文控制在合理长度。"); return; }
        synchronized (lock) { if (loadedId.isEmpty()) { call.reject("请先加载所选模型。", "NOT_LOADED"); return; } }
        if (!begin(call, "generating")) return;
        String operation;
        synchronized (lock) { operation = requestId; }
        int maximum = Math.max(1, Math.min(768, call.getInt("maxTokens", 512)));
        boolean json = call.getBoolean("json", false);
        worker.execute(() -> {
            StringBuilder text = new StringBuilder(); long[] last = {0};
            try {
                long[] metrics = NativeEngine.generate(prompt.getBytes(StandardCharsets.UTF_8), maximum, json, bytes -> {
                    text.append(new String(bytes, StandardCharsets.UTF_8));
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - last[0] >= 80) { last[0] = now; emitText(operation, text.toString()); }
                });
                emitText(operation, text.toString());
                JSObject response = new JSObject();
                response.put("text", text.toString()); response.put("requestId", operation);
                response.put("firstTokenMs", metrics[0]); response.put("tokens", metrics[1]);
                response.put("elapsedMs", metrics[2]); response.put("promptTokens", metrics[3]);
                response.put("cancelled", metrics[4] == 1); response.put("timedOut", metrics[5] == 1);
                response.put("tokensPerSecond", metrics[1] > 1 && metrics[6] > 0 ? (metrics[1] - 1) * 1000.0 / metrics[6] : 0);
                response.put("truncated", metrics[1] >= maximum);
                call.resolve(response);
            } catch (Exception e) { failed(call, e); }
            finally { finish(); }
        });
    }
    private void emitText(String operation, String text) {
        if (destroyed) return;
        JSObject event = new JSObject(); event.put("requestId", operation); event.put("text", text);
        notifyListeners("aiText", event);
    }
    @PluginMethod public void cancel(PluginCall call) {
        synchronized (lock) {
            String id = call.getString("requestId", "");
            if (busy && requestId.equals(id)) { cancel.set(true); NativeEngine.cancel(); }
        }
        call.resolve();
    }
    @PluginMethod public void unloadModel(PluginCall call) {
        synchronized (lock) {
            if (busy || releaseQueued) { call.reject("请先停止当前操作。", "BUSY"); return; }
        }
        queueRelease(); call.resolve();
    }
    @PluginMethod public void deleteModel(PluginCall call) {
        String id = call.getString("modelId", "");
        try { spec(id); } catch (Exception e) { call.reject(e.getMessage()); return; }
        if (!begin(call, "deleting")) return;
        worker.execute(() -> {
            try {
                if (id.equals(loadedId)) { NativeEngine.unload(); synchronized (lock) { loadedId = ""; } }
                File file = modelFile(id);
                if (file.exists() && !file.delete()) throw new IOException("无法删除模型，请重试。");
                verified.edit().remove(id).commit(); call.resolve();
            } catch (Exception e) { failed(call, e); }
            finally { finish(); }
        });
    }
    private void scheduleIdle() {
        main.removeCallbacks(idleRelease);
        synchronized (lock) { if (active && !loadedId.isEmpty() && !busy && !releaseQueued) main.postDelayed(idleRelease, 60000); }
    }
    private void queueRelease() {
        if (!available || destroyed) return;
        synchronized (lock) {
            if (releaseQueued) return;
            releaseQueued = true;
            if (busy && !phase.equals("choosing") && !phase.equals("importing")) { cancel.set(true); NativeEngine.cancel(); }
            if (!busy) phase = "releasing";
        }
        publish();
        worker.execute(() -> {
            NativeEngine.unload();
            synchronized (lock) { loadedId = ""; releaseQueued = false; if (!busy) phase = "idle"; }
            publish();
        });
    }
    @Override protected void handleOnPause() {
        active = false; main.removeCallbacks(idleRelease);
        synchronized (lock) {
            if (busy && !phase.equals("choosing")) { cancel.set(true); if (available) NativeEngine.cancel(); }
        }
        queueRelease();
    }
    @Override protected void handleOnResume() { active = true; scheduleIdle(); }
    @Override protected void handleOnDestroy() {
        destroyed = true; cancel.set(true); main.removeCallbacks(idleRelease);
        if (available) NativeEngine.cancel();
        worker.execute(() -> { if (available) NativeEngine.unload(); }); worker.shutdown();
    }
}
