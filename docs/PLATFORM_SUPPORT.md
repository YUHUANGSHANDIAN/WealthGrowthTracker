# 平台支持矩阵（Platform Support）

> 版本：v1.8.0 · 更新：2026-10-16

| 平台 | 架构 | 状态 | 签名 / 公证 |
|------|------|------|-------------|
| Windows | x64 | ✅ Stable | 未代码签名（SmartScreen 提示，可绕过） |
| macOS | Apple Silicon + Intel（Universal） | ✅ Stable build | ❌ ad-hoc 未签名 / 未公证 |
| Linux | x86_64 | ✅ Stable | — |
| Android | arm64-v8a / armeabi-v7a / x86_64 | ⚠️ 由 CI 用 Android SDK/NDK 与 JDK 17 构建 debug 签名预览包（本机无该工具链，未做本机验证） | ❌ 正式 release 签名待配置 |
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

## AI 支持矩阵（v1.8.0 实现状态）

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

## 视觉与联网检索（v1.8.0 新增，默认关闭）

| 能力 | 认证与权益 | 平台 | 代码现状 | 真实验收状态 |
|------|------------|------|----------|--------------|
| 图片视觉提取 `vision-extract` | 复用已配置连接的权益 | 桌面（Broker）；Web/移动需自建网关或本地端点 | 只有用户显式勾选“此连接可接收图片”的连接才会收到图片；最多 4 张 PNG/JPEG/WebP，单张与总量均有上限，超出即失败关闭；Copilot 订阅会话在登记阶段拒绝读图声明 | 未执行（取决于用户所选视觉模型；应用不做本地 OCR） |
| 网页研究检索 `research-lookup` | 不消耗订阅额度，仅抓取用户给出的公网链接 | **仅桌面**（经 Node 私有运行时） | 只接受公网 HTTPS、禁止重定向、不带凭据与 Cookie、限制体积与超时；结果字段走白名单，模型不能自行生成 URL。Web/移动端如实返回“不可用” | 未执行 |

两条能力已在界面上接入：「月度理财 → 资料与对账」的每张图片有「视觉识别」，
「情报与目标」有「联网检索（需授权）」并由你显式点「保存为研究记录」才落库。
逐步验收清单见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。

## 打包运行时的冒烟命令（各平台可复制）

桌面包把官方 Node 24.21.0 作为 sidecar 与 `ai-runtime/` 一起随包。想确认某个平台上的
运行时确实可用、且 AI 默认关闭，可在安装目录里执行：

```bash
# 1) 默认关闭：不带开关必须拒绝启动（退出码 2）
./node ai-runtime/main.mjs

# 2) 显式启用后问一次状态（Windows 用 node.exe）
printf '{"protocolVersion":1,"requestId":"smoke-1","operation":"status"}\n' \
  | ./node ai-runtime/main.mjs --stdio --enable-ai-runtime
# 期望：result.runtime = "enabled"、result.tools = []、
#       result.credentials = "private-broker-memory-only"
# macOS / Linux 的可执行文件名可能是 node，请按安装目录实际文件调整。
```

Windows 本地已完成该冒烟（见下方“签名与发布状态”）；macOS / Linux / Android 仍需在对应系统人工确认。

发布门（未满足即只能发布 preview）：至少两类厂商许可的订阅路径完成真实认证、真实推理与撤销验收；API Key、本地模型与 mock 均不计入。

## 签名与发布状态（如实说明）

- **Windows**：当前未商业代码签名，SmartScreen 显示「未知发布者」。
- **macOS**：当前为 ad-hoc 未签名、未公证构建，首次启动需系统安全确认。
- **Android**：由 CI 构建 debug 签名的预览包，**不是正式签名**，请勿用于分发；若某次 Release 未列出 APK，说明该次构建未产出（本机不具备 Android SDK/NDK 与 JDK 17，无法本地复现）。
- 桌面打包已集成 AI 运行时：官方 **Node 24.21.0** 以 Tauri sidecar 随包（下载时按官方 `SHASUMS256.txt` 校验），`ai-runtime/`（含依赖，符号链接已解引用）作为资源随包；打包版优先使用内置 Node，开发版回退 `WEALTH_AI_NODE`/PATH。
- **Windows 打包运行时冒烟：已通过（2026-10-16）**。对安装版的 sidecar 直接跑协议帧：`status`
  返回 `runtime=enabled`、`tools=[]`、`credentials=private-broker-memory-only`、各 provider 如实报
  `unsupported`；未配置连接时 `infer` 与 `vision-extract` 都返回 `PROFILE_UNAVAILABLE`（失败关闭，
  不泄漏内部信息）；不带 `--enable-ai-runtime` 时进程以退出码 2 拒绝启动（AI 默认关闭在进程级成立）。
- macOS / Linux / Android：本机无对应系统，AI 冒烟**未执行**，请用上面的可复制命令在对应系统确认。
- 上述签名相关，仅在获得对应证书/密钥后在 CI 通过 GitHub Secrets 配置。
