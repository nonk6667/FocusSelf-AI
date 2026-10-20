# 本地推理实现记录

2026-10-20：实际版本改用 llama.cpp JNI，Ollama 不随 APK 分发。

源码核查发现，社区 OllamaServer 将可执行文件复制到应用可写目录，再以 ProcessBuilder 启动，并默认 target SDK 28。当前 App 为 target 36，这条路径不满足 Android API 29+ 的执行限制。直接调用 APK 内的原生共享库可保留 target 36，避免服务端口、外部 App 与运行时可执行文件下载。

llama.cpp 固定提交 839a572a4cdecdb80d211297b8e7d7323a6e99d2。CMake 固定源码包 SHA-256，启用 Android ARM CPU 变体及 KleidiAI，运行时按 CPU 特征选择后端。首版使用 CPU 4 线程、4096 上下文；GPU/NPU 尚未接入。NativeEngine 的调用由单线程执行器串行化，取消通过原子标志及 CPU abort callback 生效。

Qwen3.5 聊天模板的非思考后缀固定为发布模板中的 `<think>\n\n</think>\n\n`，仅对目录中固定的两个模型使用。结构化任务采用 JSON grammar 限定语法，再使用 Zod 与现有领域规则检查内容；模型输出没有仓储写入入口。

模型导入以有界缓冲流式复制并计算 SHA-256，精确匹配 `public/ai-models.json` 中大小与摘要后原子替换。只支持目录中指定的 Q4_K_M 文件，不能把任意同名 GGUF 当作兼容。第一次通过 USB 开发工具预置的模型会在加载前完整校验。仅模型元信息单独保存，任务主数据格式不变。

源码重建需要 Node.js 22+、JDK 21、Android SDK 36、NDK 28.2.13676358、CMake 3.22.1。第一次原生构建下载固定的 llama.cpp 和 KleidiAI 源码；后续可复用 `.native/` 缓存。该目录、`.cxx/` 和 GGUF 权重均不进 Git；APK 内保留运行库及许可文本。

参考：[Android 执行限制](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)、[OllamaServer 启动源码](https://github.com/sunshine0523/OllamaServer/blob/master/android/app/src/main/java/io/kindbrave/ollamaserver/utils/OllamaExecutor.kt)、[llama.cpp Android](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md)。
