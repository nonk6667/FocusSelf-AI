# 安卓 / vivo 本地安装指南

## 最快的方法：安装 APK

拿到 `focus-dashboard-debug.apk` 后传到手机，在 vivo 的「文件管理」中点开并按提示安装 **Focus 工作台**。如提示禁止此来源安装，可在系统弹出的该来源权限页面允许本次使用的文件管理器安装。不同 OriginOS 版本的入口文字可能不同。

应用界面、图表和数据逻辑都已打包到 APK，装好后无需 Mac、Wi-Fi 或网页服务器。首版以本地使用为目标，没有商店上架或付费服务。首次展示九个示例任务和三个示例目标；在「偏好与数据」可清空计划重新开始。

## Android Studio 打开工程

1. 在项目根目录安装依赖：`npm ci`。
2. 运行 `npm run android:sync`，它会生成网页资源并复制到原生工程。
3. 运行 `npm run android:open`；也可以在 Android Studio 的 Open 中选择项目下的 **android 文件夹**。
4. 等待 Gradle Sync 完成。Gradle JDK 选择 **JDK 21** 或 Android Studio 自带的兼容 JDK；Android SDK 安装 **Android 16 / API 36**。
5. 选择 `app` 运行配置和模拟器或已授权手机，点击 Run ▶。

工程应用 ID：`io.focusworkspace.app`。最低 SDK 为 API 24（Android 7）；需要支持现代网页功能的 Android System WebView，建议先更新手机系统 WebView。实际界面在 API 36.1 模拟器检查；vivo V2436A 已实际连接；1.0.1 增加独立的纵向内容滚动区域，适配展开/折叠视口，并在弹窗关闭后恢复滚动。

## 用 USB 连接 vivo

1. 手机开启开发者选项中的 **USB 调试**。通常可通过「关于手机 → 软件版本信息」连续点击版本号进入；具体位置随 OriginOS 版本而异。
2. 用可传输数据的 USB 线连接 Mac，解锁手机，在手机上同意此电脑的调试授权。
3. Android Studio 设备选择器应出现 vivo。若一直没有设备，检查 USB 模式、数据线及授权；某些 vivo 系统还要求允许通过 USB 安装应用。
4. 在 Android Studio 点 Run；或运行 `npm run android:install`。

命令行检查（Mac 默认 SDK 路径）：

```bash
~/Library/Android/sdk/platform-tools/adb devices -l
```

应显示设备为 `device`，不是 `unauthorized`。安装脚本要求恰好一台已授权设备；如果还开着模拟器，可先关闭模拟器，避免装错目标。

## 每次修改后如何同步

网页功能修改后：

```bash
npm run android:sync
```

然后 Android Studio 再点 Run。若要导出 APK：

```bash
npm run android:apk
```

生成于 `releases/focus-dashboard-debug.apk`。构建脚本会使用本机 SDK 路径并生成忽略提交的 `android/local.properties`。首次构建下载 Gradle、Maven 与 npm 依赖需要网络；运行应用无需网络。若下载失败，先检查 Android Studio 的网络/代理配置，再重试同一命令。

## 数据和升级

- 浏览器与 APK 各自保存数据，不会自动互相看到任务。
- 安卓数据使用 SharedPreferences；清除网页缓存不会清掉主数据。
- 在「偏好与数据」导出 JSON，系统文件窗口中选择 Downloads / 下载目录等位置保存；导入则选择该备份文件。
- 相同应用 ID、相同签名的覆盖安装通常保留应用数据；Android Studio 的 Run 与本机调试 APK 使用本机默认调试签名。
- 换电脑构建的调试签名可能不同，会提示签名不一致。先导出备份再处理卸载/重新安装，避免丢失任务。不要把本机 debug.keystore 或正式签名密钥上传到 GitHub。
- 卸载应用或清除应用数据会删除本机计划；安卓系统自动云备份已关闭。
- 正式长期分发时，单独配置自己的 release 签名、增加 versionCode，再构建发行版。当前交付的是个人安装、开发验证用 debug APK。

## 安卓适配点

- 静态资源随 APK 打包，没有 `server.url`，也不连接 `localhost:3000`。
- 原生工程没有 Internet 权限；本机 `https://localhost` 是 Capacitor 的资源虚拟来源，不是外部网站。
- 数据写入成功才更新页面，保存失败会提示。
- 系统返回键依次关闭弹窗/侧栏，返回工作台，然后退出。
- 深色状态栏、底部手势区域和键盘安全区域适配。
- 使用系统文档保存窗口导出，不请求全盘存储权限。
- 不在后台运行结转任务；打开应用时检查过期计划。

官方文档：[环境准备](https://capacitorjs.com/docs/getting-started/environment-setup)、[Android Studio 工作流](https://capacitorjs.com/docs/android)、[系统文件保存](https://developer.android.com/training/data-storage/shared/documents-files)。

## 1.0.1 滚动修复

安卓使用固定视口内的主内容滚动容器，侧栏与弹窗分别滚动。弹窗打开时锁住背景，关闭时恢复先前的滚动状态。网页桌面版保持正常的页面滚动。

可对已连接设备运行只操作界面、不修改任务的手势回归：

```bash
node scripts/test-android-scroll.mjs --serial YOUR_DEVICE_SERIAL
```

脚本会用真实 Android 滑动输入验证上下滚动、图表区域、关闭弹窗后的恢复，并比较测试前后的持久数据摘要。默认不指定序列号时仅选择模拟器。

## 1.0.2 高刷新率

应用进入前台时，枚举当前显示器、当前分辨率的模式，选择最高且不超过 120 Hz 的支持值（兼容 120.00001 Hz 的浮点报告），通过 `preferredRefreshRate` 请求；Android 15+ 同时设置 DecorView 与 WebView 的 `setRequestedFrameRate`。不固定显示模式 ID，因此折叠屏切换后会重新选择。回到应用、恢复窗口焦点、显示/配置变化时重新请求；进入后台释放请求和显示监听，不主动产生绘制、不使用唤醒锁，也不修改手机全局刷新率。

实际刷新率仍受系统设置、省电、温控及厂商策略影响。低于 120 Hz 的屏幕选择其兼容模式；不改变显示分辨率。静止内容无需持续产生新帧。

前台打开 debug 应用后，可运行：

```bash
node scripts/test-android-refresh.mjs --serial YOUR_DEVICE_SERIAL
```

脚本连续进行三次原生滑动，同时采集约四秒 `requestAnimationFrame` 的平均频率、中位与 P95 间隔，比较持久数据摘要，并恢复原滚动位置。只写标准输出。该频率反映 WebView 调度节奏，不能等同于每帧都成功呈现；应结合 `adb shell dumpsys display` 的实际模式、真机手感及渲染诊断判断。需要已授权 USB 调试，且应用保持前台。默认仅选择模拟器，真机须明确给出序列号。

官方 API：[窗口刷新率请求](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#preferredRefreshRate)、[View 帧率请求](https://developer.android.com/develop/ui/views/animations/adaptive-refresh-rate)。

## 1.1.0 本地 AI

新增导航「本地 AI」，4B / 9B 每次只加载一个，模型文件单独导入。完整操作、固定下载源与原生构建工具版本见 [本地 AI README](local-ai/README.md)。进入后台停止生成并释放模型；空闲后自动卸载；任务数据继续使用原有仓储。模型和对话不包含在任务 JSON 中。覆盖安装保留私有模型与任务，卸载会删除。

原生采用 llama.cpp JNI，无需 Ollama 服务、root 或 Termux；APK 没有 Internet 权限。获取模型按钮在手机浏览器中打开固定来源，下载完成后使用系统文件选择器导入；断网后推理正常。仅支持指定的 Q4_K_M 文件，不接受其他版本或视觉投影文件。
