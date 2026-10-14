# Changelog

本文件记录「财富成长记 / 财富梦想实现家」各版本的变更。

## [1.7.0] - 2026-10-13

### 工作台与视觉
- 新 App Shell：桌面侧边导航、移动底部导航、顶部上下文栏与保存状态、独立总览页、全局搜索（Ctrl/Cmd+K，仅本地数据）。
- Light/Dark/System 主题、金额隐私模式覆盖卡片/图表/导出/AI 附注；Dialog 焦点陷阱与恢复、Reduced Motion、44px 触控目标。

### 报告、历史与分析（事务与口径）
- 报告 `prepare/confirm` 事务：候选快照与报告一次确认，取消不改变 History；`periodKey` 唯一性由领域层强制，重复提交幂等。
- 报告编辑事务（revision + 审计 + 派生字段重算）、周期冲突策略、报告文件投影 outbox 与可重试同步。
- 历史每日时间轴/表格、事件备注编辑事务；分析起止日期真正生效、真实日历比较、缺失断点（null gap）、区间 Top N 与稳定渠道身份。

### 存储、备份、恢复与迁移
- 浏览器：IndexedDB 单一快照 + revision CAS + 上一版本备份；桌面：单写入队列、唯一临时文件、原子替换、显式 flush 错误与坏数据只读恢复界面。
- 数据目录迁移状态机（迁移会话 ID、清单/哈希校验、失败回滚、重启恢复），移除任意绝对路径递归删除命令。
- 灵光环境写入串行化、批量失败回滚；备份 Schema 独立版本，未知字段保留。
- SheetJS 升级到官方 `xlsx@0.20.3` tarball，`.xls/.xlsx` 在 Worker 中解析并限制大小、行数与 ZIP 膨胀。

### AI 连接与受控工作区（默认关闭）
- AI 默认关闭、每次启动重置；连接中心支持多 profile、模型列表探测、合成消息测试，订阅 / API Key / 本地模型分开标注，互不冒充。
- 受控运行时边界：私有 stdio Node 运行时（`ai-runtime/`）实现受限 JSONL 协议（固定任务白名单、事实数量与字段上限），默认不启动、不读取其他 CLI 登录、不嵌入 OAuth 客户端密钥；生产适配器注册表为空，各厂商仍按“不支持”上报。
- 平台差异：Web/PWA 可连接用户自建 HTTPS 网关或本机端点并逐次授权；桌面端 Broker（Tauri `ai_*` 命令）尚未实现，桌面 App 内会明确提示运行时不可用。
- 工作区逐次授权：ContextManifest 预览（目的地、revision、字段与来源）、结构化输出校验、事实引用必须来自本地 FactPack。
- AI 余额录入产出 ChangeProposal，经本地域校验、差异预览与用户确认后由既有金额事务提交；AI 不能直接写 Store。
- 报告解读可保存为独立 AI 附注（普通备份默认不含），报告 revision 变化后标记过期。

### 质量与供应链
- Node 24、CI 分层质量门（privacy / lint / typecheck / unit / build / Rust）、隐私扫描审核 staged blob 与 NUL 路径。
- 仍待完成（如实记录）：两类合法订阅路径的真实认证/推理/撤销验收、桌面打包中的 Node sidecar 与各平台启动验证、各平台签名凭据。

## [1.6.1] - 2026-10-05

### 报告（Reports）
- **高级报告编辑器**：报告详情新增「高级编辑」，分 Tab 编辑基本信息（标题/周期/Data As Of/标签/摘要）、资产数据（期初/期末/父子渠道金额）、统计（最高/最低/平均）；周期修改自动重算 periodKey/startDate/endDate/ISO 元数据/标准标题；总资产与渠道合计不一致时给出校验；保存前展示 Diff、写入 manual-repair 审计；可选择同步修正对应 History。

### 数据（Data）
- **数据健康与维护中心**：动态 Maintenance Action Engine（`buildMaintenanceActions`）生成当前待处理任务（周报 ISO 周期 / 重复报告周期 / 重复历史日期 / 缺失月报），完成后自动消失；无任务时显示「✅ 当前没有需要执行的数据维护任务」，不再显示用户特定的「已修复 N 份」一次性状态。

### 其它
- 版本 1.6.1。

## [1.6.0] - 2026-10-05

### 存储（Storage Portability）
- **自定义数据目录**：桌面端可在「数据 → 数据存放位置」更改数据根目录；配置保存在 OS App Config Directory（storage-config.json），不在数据根目录自身。
- **事务式目录迁移**：Flush → 预迁移备份 → 递归复制整棵树（data/reports/backups/exports/…）→ 校验 → 切配置 → reload → 删除旧根；失败自动 rollback，原数据不受影响。
- 跨磁盘安全（复制而非 rename）；目标为当前/内部/父目录会被拒绝；默认目录继续兼容。

### ISO 周报完整性（ISO Report Integrity）
- **ISO Week Domain**：新增 `src/utils/isoWeek.ts`（canonicalWeeklyPeriod / resolveWeeklyIdentity / isoWeekRange），一周 Monday→Sunday、正好 7 天、Week 1 含 1/4。
- **旧周报周期 canonicalize**：`normalizeFinancialReport` 不再用 `??` 保留旧错误的 startDate/endDate/weekNumber/isoWeek/isoWeekYear/standardTitle，统一修复为 ISO 周期（Report Schema v4）。
- Custom Title 保留，standardTitle 仍修正；旧来源日期范围可存入 `legacySourceMetadata`。
- Data Health 新增 Period Integrity Check（周期非法 / isoWeek 冲突 / weekNumber 冲突 / 月年边界 / 标题不符）。

### 报告唯一性（One Report Per Period）
- 移除「另存一份报告」：每个 `weekly:YYYY-Www` / `monthly:YYYY-MM` / `yearly:YYYY` 只允许一份 canonical report；冲突只提供「更新」或「取消」，归档报告提供「取消归档并更新」。

### 历史一天一条（Daily Snapshot Consistency）
- History Domain 新增 `prepareHistoryUpsert` / `overwriteHistoryPoint`：一天最多一条 HistoryPoint，手动添加/编辑日期撞车时弹冲突确认，绝不静默覆盖。
- HistoryPoint 增加 `source`（live-snapshot / manual / weekly-report / import / legacy / OCR / backfill）与 `updatedAt`。
- **周报生成 = 一次 Daily Snapshot 写入**：先同步当天 History（无冲突则写、相同则复用、不同则弹冲突），再生成报告，保证 Report 与 History 一致。

### 报告完整性（Report Integrity）
- 新增 `integrityStatus`（verified / reconstructed / needs-review），UI 不再显示「部分完整」；历史序列稀疏单独显示「历史记录点 N 个」，不伪造数据。

### UI
- 统一 `SliderField` 替换原生 range（背景透明度 / 金币雨风力 / 报告图片质量），实时显示当前值、支持键盘、携带 aria 值。
- History 列表显示来源 Badge。

### 其它
- 版本 1.6.0（package.json / Cargo.toml / tauri.conf.json / version.ts / backup 同步）。
- Backup 升级到 v1.6.0，仍兼容 v1.0 ~ v1.5。

## [1.5.0] - 2026-10-05

### 资产（Assets）
- **父渠道 ⇄ 子渠道生命周期修复**：任何父渠道始终提供「＋ 子渠道」，空父渠道仍可直接记录金额。
- **无损结构转换**：父渠道有直接金额时添加首个子渠道，弹出「金额归属」选择（转入新子渠道 / 创建「未分类」/ 清空直接金额，需二次确认）；默认保持总资产不变。
- **删除最后一个子渠道显式交互**：可选「保留为父渠道直接金额」（推荐）或「同时删除该金额」，杜绝隐式金额行为。
- 转换逻辑集中为纯函数 `promoteParentToChildren` / `collapseParentToDirectAmount`，并同步今日历史快照。
- **京东金融**：默认父渠道新增「京东金融」（京东小金库 / 基金 / 股票 / 黄金 / 京东活钱+），并做 v1.4→v1.5 幂等 Migration（按规范化名称去重，保留用户已有子渠道数据）。

### 财务报告（Reports）
- **Report Schema v3**：新增 `assetComposition`（父渠道 rollup + 子渠道 breakdown，含 percentageOfParent / percentageOfTotal），父级与子级都保存、绝不父子 double-count。
- **Data As Of**：报告记录数据快照截止日期（该周期最后有效记录），UI 显示「数据截至」，绝不虚构真正月末值。
- **generationSource**：区分正常生成 / 旧版文本导入 / 旧版图片导入 / 历史补月报。
- 旧报告只有扁平 channelDetails（无父子映射）时不猜父关系，显示明确 warning。
- 报告详情「资产构成」改为两层：父渠道构成 + 点击展开子渠道明细（占父渠道 / 占总资产）。
- 分享图片与 HTML 同步展示父子层级，避免混淆。

### 彩票（Lottery）
- **Current Pool Balance 与 Lifetime Performance 分离**：当前资金池只基于真实 ledger 交易；全生命周期表现额外纳入 summary-only 历史项目与未归属交易，绝不 double-count。
- 「💼 注入/取出」按钮改为真正的资金池设置；新增「➕ 资金注入」「↩️ 资金取出」按钮创建真实交易。
- **Project CRUD**：新增 / 编辑 / 归档 / 详情；有交易的项目禁止直接删除（建议归档，避免 orphan）。
- **Project Detail**：Overview / 交易明细 / ROI / 数据类型（详细交易 / 历史汇总）。
- **项目净盈亏升级**：0 中线横向正负 Bar，按净盈亏 / ROI / 支出 / 收入 / 交易数排序，可筛选 / 点击进详情。
- **交易编辑** + 删除确认（显示类型 / 日期 / 金额 / 项目，写入活动日志）。
- 彩票健康检查扩展：详细项目无交易 / summary-only 有交易 / 重复项目 / 非法日期范围 / 非法 adjustment 方向。

### 分析（Analysis）
- 新增 `channelStructureChange`：期初 → 期末结构变化（金额变化 + 占比变化百分点），纯描述性统计。

### 数据（Data）
- **报告覆盖情况**：按年份统计月报覆盖（如 2025：月报 10/12）。
- **缺失月报补生成**：预览（Create / Repair / Skip）+ 执行；使用当月最后有效 HistoryPoint 作为 dataAsOf，绝不生成 0 元报告、绝不重复生成。
- **历史报告导入器**：`legacyReports.ts`（TXT/图片配对、解析、与现有报告/历史 reconciliation、字段来源优先级）。
- **匿名诊断导出**：只含版本 / schema / 各域数量 / 健康问题类型 / 平台 / 存储后端，绝不包含金额 / 渠道名 / 报告内容 / 彩票交易 / PIN。

### 隐私（Privacy）
- **移除真实数据样例**：默认银行卡匿名化（不再含真实卡号尾号），彩票测试 Fixture 全部合成化。
- **Privacy Guard**：`npm run privacy:check`（scripts/privacy-check.mjs）阻止 app-state / 备份 / xlsx / 历史报告目录进入 Git，CI 同步运行。
- .gitignore 增加用户隐私数据防御性条目。

### 其它
- 版本 1.5.0（package.json / Cargo.toml / tauri.conf.json 同步）。
- Backup 升级到 v1.5.0，仍兼容 v1.0 ~ v1.4。
- Emoji / Color Registry v2：拆分 FEATURE_META / ACTION_META / REPORT_META / CHANNEL_SUGGESTIONS / LOTTERY_META / STATUS_META / SEMANTIC_COLORS。

## [1.4.0] - 2026-10-04

### 财务报告（Reports）
- **同周期报告不再静默覆盖**：生成冲突时弹 ReportConflictDialog（更新 / 另存 / 取消），归档报告绝不静默覆盖。
- **可编辑元数据**：自定义标题（titleMode auto/custom + standardTitle）、标签、自定义摘要、归档说明；更新报告时保留用户标题。
- **历史报告修复**：`repairReportFromHistory` 用真实 HistoryPoint 恢复 previousTotal / 极值 / 渠道构成，记录 fieldProvenance + repairAudit，绝不编造。

### 数据健康（Data Health Center）
- 升级为交互式健康中心：按域分组、展开详情、定位到数据、忽略、安全修复（修复前自动备份）。
- DataIssue 增加 domain / entityId / title / evidence / fixStrategies / safeAutoFix / possiblyDestructive。
- 新增彩票健康检查（Pool 为负是合法的，交易金额 <=0 是错误）。

### 图标（Icons）
- `featureMeta.ts` 集中管理功能/动作/彩票类别/交易类型 Emoji，语义统一。

### 分析（Analytics）
- 历史渠道构成支持金额模式 / 100% 占比模式、父渠道 / 叶子渠道、TOP N、缺快照日期显示为缺口（不当作 0）。

### 彩票（Lottery）
- 新增独立资金池账本（Pool / Project / Transaction / Settings），完全排除财富资产 / 等级 / 目标 / 预测 / 标准报告。
- 净盈亏 = 中奖 − 投注（注入非盈利、取出非亏损）；净盈亏率（ROI）指标。
- 每日统计、累计净盈亏、项目汇总全部由交易动态推导。
- **旧彩票 Excel 导入**：识别 汇总表 / 每日统计 / 交易明细，收入→prize、支出→stake、其他→adjustment，summary-only 项目保留 legacySummary、detailed 项目从交易推导；幂等指纹防重复。
- 彩票 CSV（交易 / 项目汇总）导出。

### 连通性（Connectivity）
- 统一 Navigation Layer（hash 路由 + 跨 Feature 深链）。
- Data 概览卡片可点击（报告/历史/目标/彩票）、Health Issue 可定位、Report→Analysis、Goal→Prediction。

### 其它
- 活动日志（本地，记录事件类型/时间/实体/描述，不记录完整资产 JSON 或密码）。
- Backup 升级到 v1.4（含 lottery/goals/achievements），旧备份仍兼容。

## [1.3.0] - 2026-10-04

### 财务报告（Reports）
- **Report Schema v2**：`reportSchemaVersion` / `reportRendererVersion` / `periodKey` / `dataCompleteness` / `dataWarnings` / `revision` / `sourceVersion`。
- **规范化管线**：`normalizeFinancialReport`（纯函数、确定性、幂等），历史报告缺失 `title`/`weekNumber`/`year`/`wealthLevel`/`topChannels` 等字段时安全补齐，**绝不编造**渠道构成/期间极值。
- **ISO-8601 周编号**：修正旧自定义算法（无 Week 0、跨年周一致），`periodKey` 统一为 `weekly:2026-W40` 等。
- **历史报告自动升级**：hydrate 时检测 → 备份 → 持久化规范化报告 → 重渲染桌面 JSON/HTML。
- **报告去重/更新**：同 `periodKey` 默认更新原报告（递增 `revision`），归档报告不静默覆盖。
- **报告 Dashboard**：KPI（总数/本周/本月/本年变化/最近生成/完整度）、类型 Tabs、时间筛选、**多维排序**（强类型字段 + 预设）。
- **报告详情分区**：概览/周期统计/趋势/资产构成/历史比较/财富等级/数据质量/备注/分享。
- **Share Center**：4 种模板（简洁卡片/完整报告/社交 4:5/Story 9:16）、**隐私模式**（完整/金额模糊/仅百分比/隐藏金额）、实时预览、PNG/JPEG/WebP、透明背景。

### 财富等级（Wealth Level）
- **定义与主题解耦**：`WealthLevelDefinition`（逻辑）与 `WealthTheme`（视觉 token）分离。
- **视觉优化**：高财富等级移除 crimson/red 主色（改为铜金/深蓝金），红色仅用于「下降/风险」语义。
- **Level Achievement / 财富成长护照**：记录首次达成等级时间，从历史安全回推（不伪造日期）。
- **主题预览**：Level Explorer 可预览主题（不改变真实等级）。

### 分析（Analytics）
- Analytics Dashboard：KPI（起点/变化/变化率/极值/覆盖率）、时间范围+粒度+平滑、**历史渠道构成**（堆叠图）、**渠道变化**、**资产集中度**（TOP1/TOP3/HHI）、**WoW/MoM/YoY**、可解释雷达。

### 预测（Prediction）
- **Training Window Stability**（90/180/365/全部）、**Horizon Backtest**（30/90/180）、**Model Disagreement**（非风险概率）、**Outlier Sensitivity**（绝不自动删数据）、**Goal Required Path**、**80/90/95 预测区间**（真正重算）、CSV 导出 metadata。

### 目标（Goals）
- **Goals V2**：多目标、Primary Goal、状态（未开始/进行中/已达成/已过期/已归档）、目标编辑器（名称/图标/金额/起止/时区/显示格式/备注/颜色）+ 校验。旧 `CountdownData` 幂等迁移为主目标。

### 图表与 UI
- 新增 `StackedBarChart`、统一 `ChartFrame` 基础（响应式 SVG、无障碍 aria-label、十字光标）。

### 平台（Platforms）
- **Platform Capability Layer**（`canOpenFolder`/`canNativeShare`/`canCopyImage` 等），Android 隐藏「打开数据文件夹」。
- **跨平台存储**：Rust `open_path` 按 `cfg(target_os)` 分派（Windows/macOS/Linux），移动端使用 app_data_dir（Scoped Storage）。
- **Windows / macOS / Linux / Android 发行**：GitHub Actions 多平台流水线 + SHA256SUMS。
- **PWA**：manifest + 图标 + 离线 shell（Service Worker 只缓存外壳、不缓存用户数据）。
- **HarmonyOS**：无 Stable 原生 HAP（如实说明），提供 Web/PWA 兼容，见 `docs/HARMONYOS.md`。

### 安全（Security）
- **CSP**：不再为 `null`，收紧为 `default-src 'self'` + 白名单。
- 保持 Local-First / Privacy-First，无 analytics/telemetry/广告/云同步。

## [1.2.0] - 2026-10-03

### 财富等级（Wealth Level）
- 8 个财富等级各自拥有结构化视觉 Theme Token（primary/secondary/accent/surface/glow/heroGradient/progressGradient/chartAccent 等），通过 CSS Variables 全局生效。
- 新增「财富等级体系」查看器：等级阶梯 + 详情 + 里程碑 + 距离下一级金额；明确说明是游戏化成长体系，非投资评级。

### 倒计时（Countdown）
- 支持 IANA 时区（date-fns-tz）、起始/目标日期+时间、年月日时分秒 / 日时分秒 / 总小时 / 简洁四种显示格式。
- 倒计时跟随真实系统时间（每秒刷新、睡眠/后台恢复不漂移），时间进度 + 金额进度双指标。

### 庆祝（Celebration）
- 新增等级升级 / 目标达成庆祝 Overlay（与金币雨分离，避免重叠）。
- 只有「真实金额编辑」触发、等级上升才升级、目标跨越 + goalKey 变化才达成；导入/重启不重复触发。

### Dashboard
- 主资产面板升级为 WealthHeroCard：总资产 / 等级进度 / 目标进度 / 倒计时简报 / 30 天 sparkline / 最近变化，跟随等级主题。

### 资产（Assets）
- 校园卡新增三所默认学校（大连理工/天津/复旦），v1.1→v1.2 幂等迁移。
- 智能综合排序（金额/增长/活跃/更新时间加权，本地评分 + 可解释分解）；增长率排序真正接入历史快照；排序模式与置顶持久化。

### 数据（Data）
- 数据概览、数据健康检查（非法金额/重复 ID/孤立子渠道/重复日期，可安全修复并自动备份）。
- 导入支持「合并/覆盖」两种模式（预览 + ID/日期优先）；渠道/历史 CSV 导出。

### 预测（Prediction）
- 图表控制面板：显示范围 / 时间维度（期末值聚合）/ 训练窗口 / 图表样式 / 显示项开关，全部持久化。

### 报告分享（Reports）
- 报告图片导出 PNG/JPEG/WebP（格式/质量/分辨率可选）、复制图片到剪贴板、微信分享工作流、邮件分享（mailto）、系统分享（能力检测）。

### 设置（Settings）
- 个人资料（昵称/头像/签名/时区）、外观（主题/动画强度/减少动画）、本地账户锁（PBKDF2 不明文，登出不删除资产）、手动更新检查（仅点击时访问 GitHub）、隐私说明、关于。

## [1.1.0] - 2026-10-03

### 预测引擎升级（Prediction）
- **真实时间轴**：所有模型统一使用 `elapsed days` 作为自变量，不再把「第 N 条记录」当成等间隔。
- **线性模型**：改为真正的 `Y(t) = intercept + slope × t` 线性外推（此前误用复合增长公式）。
- **指数模型**：改用 log-linear 回归，利用全部正数历史点（此前只看首尾 CAGR）。
- **保守/积极**：重新定位为「保守情景 / 积极情景」，基于 residual bootstrap 的斜率分位（p10 / p90），移除任意经验系数。
- **混合模型**：改为 rolling-origin 回测驱动的动态 ensemble（RMSE 倒数 + 下限正则化），不再固定等权。
- **回测**：rolling-origin 时间序列验证，输出 MAE / RMSE / sMAPE 与窗口数。
- **预测区间**：线性/指数用解析 95% 预测区间，混合用可复现残差 bootstrap；数据不足时明确提示「暂不显示统计预测区间」。
- **移除伪「置信度」**：不再用 `R² × (1-波动率)` 冒充统计置信度，改用拟合质量 / R² / MAE / RMSE / sMAPE。
- **多跨度预测**：30 / 90 / 180 / 365 / 730 天 + 自定义；根据跨度自动调整采样密度。
- **目标金额预测**：给出「中心轨迹下预计何时达到目标」，下降/未达标时如实提示。
- **模型诊断**：每个模型可查看参数、R²、MAE/RMSE/sMAPE、回测窗口、残差图、是否 fallback。
- **数据健康检查**：数据点、跨度、平均间隔、最大缺口、异常跳变点（仅提示、不自动删除）。
- 新增 19 项合成数据集单测（线性/指数/恒定/下降/0 值/大金额/异常点/bootstrap 可复现等）。

### 图表升级（Charts）
- 参考 OriginPro 表达：历史数据点 + 拟合线 + 预测线 + 预测带 + 参考线 + 预测分界标记。
- X 轴使用真实日期坐标（非等距索引），刻度按日/周/月/季度/年自适应。
- 十字光标 + Hover Tooltip（历史/拟合/预测/上下界/与上一点变化）。
- 图例点击隐藏/显示曲线；模型比较模式 + 模型指标表。
- 导出 PNG / SVG / 预测数据 CSV。

### 报告与数据准确性（Reports / Data）
- 新历史快照保存完整渠道深拷贝快照 + 财富等级 + 时间戳。
- 过去周期报告改用历史快照计算期末资产与渠道构成，不再拿「今天的数据」冒充过去。
- 旧版历史无渠道快照时明确标记 `channelSnapshotMissing`。
- schema 版本升至 **1.1.0**（兼容 1.0.0 JSON 导入）。

### Windows 桌面版（Desktop，Tauri 2）
- 新增 Tauri 2 桌面应用，复用同一套 React 前端。
- 数据持久化到 `文档\财富成长记\`（`data/app-state.json`），不再依赖 localStorage。
- 原子写入（临时文件 + rename）、debounced 序列化写入。
- 自动备份（每天首次保存 + 版本升级前 + 导入覆盖前），保留最近 60 个自动备份、不删手动备份。
- 报告持久化为 JSON + HTML 到 `reports/{weekly,monthly,yearly}/`。
- 数据页新增：显示存储路径、打开数据/备份文件夹、手动备份、从备份恢复。
- 损坏数据自动保留并尝试从最近备份恢复。

### 测试与工程（Tests / CI）
- 新增桌面存储单测（内存文件系统模拟：首次启动 / 原子写 / 损坏恢复 / 自动备份轮换 / 恢复 / 报告写盘）。
- 新增 GitHub Actions Windows Release 工作流（lint → typecheck → test → cargo fmt → Tauri build → NSIS/MSI → SHA256）。
