# 平台支持矩阵（Platform Support）

> 版本：v1.7.0 · 更新：2026-10-14

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
| 数据存储 | 文件（`文档\财富成长记\`） | 文件（`~/Documents/财富成长记`） | 文件（`~/Documents/财富成长记`） | App-specific 目录（scoped storage） | IndexedDB 单快照（revision CAS + 上一版本备份） |
| 单写入者 / 原子写 | 写入队列 + 唯一临时文件 + 原子替换 | 同左 | 同左 | 平台存储串行写入 | IndexedDB 事务 CAS |
| 灵光环境 | — | — | — | — | 灵光 storage 适配器（串行队列 + 失败回滚） |
| 打开数据文件夹 | ✅ | ✅ | ✅ | ❌（SAF 文件选择） | ❌ |
| JSON 导入/导出 | ✅ | ✅ | ✅ | ✅（系统文件选择器/SAF） | ✅ |
| 数据目录迁移（会话 ID + 校验 + 回滚） | ✅ | ✅ | ✅ | ❌ | ❌ |
| 报告图片分享 | 剪贴板/保存 | 系统分享/保存 | 系统分享/保存 | 系统分享 Sheet | Web Share API |
| 更新检查（GitHub Releases） | ✅ | ✅ | ✅ | ✅（推荐 APK） | ✅（CSP 仅放行 api.github.com 与 HTTPS） |
| 自动备份 | ✅ | ✅ | ✅ | ✅（应用内目录） | 上一版本快照（IndexedDB） |

## 数据目录与平台细节

- **Windows / macOS / Linux**：`文档/财富成长记/`（`data/`、`backups/`、`reports/`、`exports/`）；Documents 不可用时回退平台 AppData 目录。迁移使用后端持有的迁移会话，绝不接受前端传入的任意删除路径。
- **Android**：应用专属内部数据目录（`app_data_dir`），遵守 Scoped Storage，不申请 `MANAGE_EXTERNAL_STORAGE`；备份/恢复通过系统文件选择器（SAF）。
- **Web**：IndexedDB 业务快照；生产构建注入受限 CSP（`script-src 'self'`，无 `unsafe-eval`，联网仅本应用、HTTPS 与本地回环端点）。Service Worker 不缓存用户资产 JSON。

## AI 支持矩阵（v1.7.0 实现状态）

AI 默认关闭，每次启动重置；关闭时不启动运行时、不联网、不读取凭据。以下为代码与官方依据可核实的现状；**没有两类合法订阅的真实认证/推理/撤销验收前，不得宣称“订阅已支持”**。

| 连接 | 认证与权益 | 平台 | 代码现状 | 真实验收状态 |
|------|------------|------|----------|--------------|
| OpenAI API | API Key（按量） | 桌面（Broker）、Web 网关 | 适配器与策略已实现（不写死模型名） | 未执行（需用户自有 Key） |
| OpenAI 开源应用订阅 | 官方开源应用授权 | 桌面优先 | `openai-siwc/` 授权安全服务 + 适配器；资格未核实前保持 `qualification-pending` | **未通过**（官方资格/客户端身份待确认） |
| GitHub Copilot 订阅 | GitHub OAuth/设备流 + Copilot 订阅 | 桌面优先 | Copilot 适配器（`mode: "empty"`、零工具、独立环境、`gitHubToken`） | **未通过**（需自有 OAuth App 与真实订阅） |
| Anthropic API | API Key（按量） | 桌面、Web 网关 | 适配器已实现；不支持第三方复用 Claude.ai 订阅 | 未执行 |
| DeepSeek API | API Key（按量） | 桌面、Web 网关 | OpenAI 兼容适配器 | 未执行 |
| Ollama / LM Studio | 本地端点（无云端权益） | 桌面；Web 需回环/显式配置 | 本机回环白名单与能力探测 | 未执行（不计入订阅门） |
| 用户自建 HTTPS 网关 | 用户自有认证/账单 | Web、桌面、Android | 桌面 Broker + Web 显式网关 | 未执行（Web 无默认代理） |
| Gemini | — | — | 官方资料未稳定核实前不显示入口 | 阻塞 |

发布门（未满足即只能发布 preview）：至少两类厂商许可的订阅路径完成真实认证、真实推理与撤销验收；API Key、本地模型与 mock 均不计入。

## 签名与发布状态（如实说明）

- **Windows**：当前未商业代码签名，SmartScreen 显示「未知发布者」。
- **macOS**：当前为 ad-hoc 未签名、未公证构建，首次启动需系统安全确认。
- **Android**：当前为 debug 签名的 APK 预览；正式 release 签名（keystore）待配置后提供 AAB。
- Rust Broker 与 Node 运行时源码均已就绪（Broker 通过 clippy 与单元测试）；**跨平台打包尚未完成**：Node 二进制/sidecar 打包、资源路径与各平台启动验证仍待完成，打包后需在 Windows/macOS/Linux 目标上重新验证。
- 上述签名相关，仅在获得对应证书/密钥后在 CI 通过 GitHub Secrets 配置。
