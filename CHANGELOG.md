# Changelog

本文件记录「财富成长记 / 财富梦想实现家」各版本的变更。

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
