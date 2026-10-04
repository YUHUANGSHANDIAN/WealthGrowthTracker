# 未来规划（暂不实现 / 待外部条件）

以下能力被有意排除在 v1.3.0 之外，记录为未来方向，避免阻塞发布。

## 代码签名与公证（需外部证书/账号）

- **Windows**：购买 EV/OV 代码签名证书，在 GitHub Secrets 配置 `WINDOWS_CERTIFICATE`（base64 PFX）+ 密码，用 `azure-trusted-signing` 或 `signtool` 签名。
- **macOS**：配置 Apple Developer ID + notarization secrets 后，产出无警告双击安装的 DMG。
- **Android**：配置 release keystore（`ANDROID_KEYSTORE_BASE64` 等 secrets）后，产出正式签名的 APK/AAB。

## 自动更新（Tauri Updater）

- 已实现「手动更新检查」（设置 → 版本更新，仅点击时访问 GitHub API）。
- 未来可用 `tauri-plugin-updater` + 签名密钥对 + `latest.json` 做应用内自动更新。

## 本地数据加密

- 已实现「本地账户锁」（PBKDF2，应用锁，非磁盘加密）。
- 未来可引入 SQLite（`tauri-plugin-sql`）或对 `app-state.json` 做本地加密（`keyring` + `age`/`chacha20`）。

## 数据目录迁移

- 当前数据目录固定为 `文档\财富成长记\`（Android 用 app-specific 目录）。
- 未来可通过原生目录选择器实现「更改数据文件夹」。

## 深色模式（Dark Mode）

- v1.3 已新增等级主题的 `dark` token（`surface/surfaceElevated/border/text`），但**完整 Dark Mode（图表/弹窗/输入框/分享图片全部正确）尚未实现**，设置里仍标注「即将推出」。

## HarmonyOS 原生 HAP

- 当前无 Stable 原生 HAP（Tauri 官方未支持）。跟踪官方进度；官方 stable 后在同一 Frontend 产出原生 HAP。见 `docs/HARMONYOS.md`。

## PDF 直接导出

- 当前通过 HTML 打印（浏览器/系统「打印 → 存为 PDF」）。
- 未来可用轻量可靠方案做直接 PDF（稳定性优先，不引入几十 MB 浏览器库）。

## 云同步 / 账号系统

- **明确不做**：云同步、用户账号、Supabase/Firebase、在线数据库、真正的大模型 API、股票行情 API、多人协作。
- 核心定位保持：local-first、privacy-first、单用户个人财富追踪。
