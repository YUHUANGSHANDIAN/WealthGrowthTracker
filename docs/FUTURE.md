# 未来规划（暂不实现的选项）

以下能力被有意排除在本版本（v1.1.0）之外，记录为未来可选方向，避免当前版本因它们而阻塞发布。

## Windows 代码签名
- 当前安装包未签名，SmartScreen 会提示「未知发布者」。
- 未来：购买 EV / OV 代码签名证书，在 GitHub Secrets 中配置 `WINDOWS_CERTIFICATE`（base64 PFX）、`WINDOWS_CERTIFICATE_PASSWORD`，并在 release workflow 中使用 `azure-trusted-signing` 或 `signtool` 签名。

## 自动更新（Tauri Updater）
- 已实现「手动更新检查」（设置 → 版本更新，仅点击时访问 GitHub API）。
- 未来可通过 `tauri-plugin-updater` + GitHub Releases 实现应用内自动更新（需维护 updater 签名密钥对并发布 `latest.json`）。

## 本地数据加密
- 已实现「本地账户锁」（PIN/密码，Web Crypto PBKDF2 + 随机盐，不明文存储）。注意：这是**应用锁**，不等于磁盘加密。
- 未来可引入 SQLite（`tauri-plugin-sql`）或对 `app-state.json` 做本地加密（如 `keyring` + `age`/`chacha20`）。

## 数据目录迁移（更改数据文件夹）
- 当前数据目录固定为 `文档\财富成长记\`。
- 未来可通过原生目录选择器实现「更改数据文件夹」，需：选择目录 → 复制 → 校验 → 切换 → 保留原目录。

## 云同步 / 账号系统
- 明确不做：云同步、用户账号、Supabase/Firebase、在线数据库、真正的大模型 API、股票行情 API、多人协作。
- 核心定位保持：local-first、privacy-first、单用户个人财富追踪。

## 其它
- 同比 YoY / 环比 MoM 对比（当前历史数据不足时显示「数据不足」）。
- 更丰富的报告导出（PDF 直接导出，当前通过 HTML 打印）。
- 移动端（Android/iOS）Tauri 打包（当前仅 Windows x64）。
