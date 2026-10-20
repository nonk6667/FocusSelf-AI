# 后续 Supabase 同步设计（未启用）

首版不加载 Supabase SDK、不要求云账号、不做网络请求。`supabase/schema.sql` 是可选的设计草案，尚未部署或在真实 Supabase 实例验证。

## 数据模型与仓储

现有领域模型包含 projects、goals、milestones、tasks、settings、version 和 updatedAt。当前适配器：浏览器 LocalRepository，安卓 NativeRepository。它们实现相同的 DashboardRepository 接口，应用在保存成功后更新 UI。

第一步云同步建议保留一个用户一份 JSON 快照，避免第一版就引入复杂多表合并。云端记录有 owner_id、revision、state、updated_at；state 的 schema version 与云端 revision 分开。前者用于数据格式迁移，后者用于并发检测。领域模型仍可在后续演进为规范化 project/goal/milestone/task 表。

## 鉴权与权限

使用 Supabase Auth（例如邮件 OTP）。客户端仅使用公开 URL 和 publishable / anon key，RLS 对 SELECT/INSERT/UPDATE 全部限制为 auth.uid() = owner_id。不得在前端放 service_role key。用户上传数据前需要确认首次迁移；应用未登录时仍保留完整本地功能。

当前安卓 Manifest 没有 Internet 权限。实施同步时需显式加入网络权限，并让界面清楚显示登录及同步状态；不能把当前「本地优先」提示当成已连接云端。

## 写入、离线与冲突

1. 本地每次修改先可靠保存，同时持久化待同步快照和其 baseRevision。浏览器用 IndexedDB 或本地 outbox；安卓用 SQLite 或 Preferences outbox。
2. 联网后读取远端 revision，调用 save_focus_snapshot(expected_revision, new_state)。首次云端创建传 0。
3. 仅当版本匹配时上传成功；成功后保存返回 revision，并清除对应 outbox。未成功不能显示「已同步」。
4. 若另一设备已推进 revision，保留本地及云端两份快照，显示数量和时间摘要，让用户选择本地覆盖、采用云端或先导出备份；不要按客户端时钟静默覆盖。
5. 网络失败以退避重试，应用前台恢复时重试。后台同步在第二阶段明确设计，不假设手机会持续运行网页代码。
6. 账号退出时处理待同步更改与本地副本，不能将 A 用户数据直接同步到 B 用户。

快照方案的取舍是并行编辑会发生整份冲突。后续若拆成多表，应增加稳定 UUID、每记录 revision、软删除 tombstone，并定义字段级合并。任务完成与重新打开也应视为会冲突的变更。

## 必须通过的后续验收

跨设备创建/完成/删除一致；离线重开不丢 outbox；同基线双设备修改不静默丢失；RLS 拒绝其他用户；退出/切换账号隔离；格式迁移可逆且有备份；手机系统终止进程后能恢复未同步状态。
