# 平台支持矩阵（Platform Support）

> 版本：v1.3.0 · 更新：2026-10-04

| 平台 | 架构 | 状态 | 签名 / 公证 |
|------|------|------|-------------|
| Windows | x64 | ✅ Stable | 未代码签名（SmartScreen 提示，可绕过） |
| macOS | Apple Silicon + Intel（Universal） | ✅ Stable build | ❌ ad-hoc 未签名 / 未公证 |
| Linux | x86_64 | ✅ Stable | — |
| Android | arm64-v8a / armeabi-v7a / x86_64 | ✅ 可构建（APK 预览） | ❌ 正式 release 签名待配置 |
| Web / PWA | 任意现代浏览器 | ✅ Stable | — |
| HarmonyOS | — | ⚠️ Experimental / PWA fallback | 见 [HARMONYOS.md](HARMONYOS.md) |

## 各平台能力

| 能力 | Windows | macOS | Linux | Android | Web/PWA |
|------|:---:|:---:|:---:|:---:|:---:|
| 数据存储 | 文件（`文档\财富成长记\`） | 文件（`~/Documents/财富成长记`） | 文件（`~/Documents/财富成长记`） | App-specific 目录（scoped storage） | localStorage |
| 打开数据文件夹 | ✅ | ✅ | ✅ | ❌（SAF 文件选择） | ❌ |
| JSON 导入/导出 | ✅ | ✅ | ✅ | ✅（系统文件选择器/SAF） | ✅ |
| 报告图片分享 | 剪贴板/保存 | 系统分享/保存 | 系统分享/保存 | 系统分享 Sheet | Web Share API |
| 更新检查 | ✅ GitHub Releases | ✅ | ✅ | ✅（推荐 APK） | ✅ |
| 自动备份 | ✅ | ✅ | ✅ | ✅（应用内目录） | ❌（浏览器本地） |

## 数据目录

- **Windows / macOS / Linux**：`文档/财富成长记/`（`data/`、`backups/`、`reports/`、`exports/`）。
  - 若系统 Documents 不可用，桌面端回退到平台 AppData 目录。
- **Android**：应用专属内部数据目录（`app_data_dir`），遵守 Scoped Storage，不申请 `MANAGE_EXTERNAL_STORAGE`。
  - 备份/恢复通过系统文件选择器（SAF / Create Document）导出/导入。
- **Web**：`localStorage`（业务数据） + Service Worker 只缓存应用外壳（`dist/` 静态资源），**不缓存用户资产 JSON**。

## 数据互通

JSON 备份格式跨平台一致：Windows 导出的 JSON 可在 Android / macOS / Linux / Web 导入，反之亦然。字段名与灵光旧版逐字对齐（`wealth_tracker_data`、`financial_reports`、`countdown_data` 等）。

## 签名与发布状态（如实说明）

- **Windows**：当前未商业代码签名，SmartScreen 显示「未知发布者」。
- **macOS**：当前为 ad-hoc 未签名、未公证构建，首次启动需系统安全确认。
- **Android**：当前为 debug 签名的 APK 预览；正式 release 签名（keystore）待配置后提供 AAB。
- 上述签名相关，仅在获得对应证书/密钥后在 CI 通过 GitHub Secrets 配置。
