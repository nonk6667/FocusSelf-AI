# 贡献指南

欢迎提交任务管理、本地 AI 和安卓体验相关的问题或改进。项目面向本地使用，无需云服务账号。

## 开发

使用 Node.js 22+，在仓库根目录运行：

```bash
npm ci
npm run dev
```

安卓开发另外需要 JDK 21、Android SDK 36、NDK 28.2.13676358 和 CMake 3.22.1。运行 `npm run android:sync` 更新网页资源，再用 Android Studio 打开 `android/`。完整说明见 [主 README](README.md) 与 [本地 AI 指南](docs/local-ai/README.md)。

## 提交前检查

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

修改原生代码后运行 `npm run android:apk`。真实模型测试需要已导入模型的授权安卓设备；接口桩测试不能替代真机测试。请在 PR 中说明修改内容、执行过的检查及未验证的范围。

## 数据与兼容性

- 使用合成任务复现问题。日志、截图、导出文件不要包含个人任务、聊天或凭据。
- 不提交模型权重、构建产物、签名文件、SDK 路径或本地编辑器配置。
- 任务存储格式的变更需要兼容已有数据，并保留无损恢复路径。
- AI 草稿必须经过现有领域规则和用户确认，不得直接修改任务库。
- 保留依赖和模型的许可声明；项目源码按 MIT 提供。

报告问题时请说明 App 版本、设备/系统、复现步骤、预期与实际结果。未有 GPU/NPU 或持续性能实测时，不要将其标为支持或已优化。
