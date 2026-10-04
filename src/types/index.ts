// 领域类型定义 —— 字段名尽量与灵光旧版备份数据保持一致，保证 JSON 导入导出兼容。

/** 金额单位统一为人民币「元」，内部以 number 存储，展示/写入时用 money 工具做两位小数舍入。 */
export type Money = number;

/** 子渠道（挂载在某个父渠道之下，真正持有金额）。 */
export interface SubChannel {
  id: string;
  name: string;
  emoji: string;
  amount: Money;
  color: string;
  parentId: string;
}

/** 父渠道：可以包含若干子渠道，也可以自身不设子渠道（此时金额直接记在父渠道上）。 */
export interface Channel {
  id: string;
  name: string;
  emoji: string;
  amount: Money;
  color: string;
  isParent: boolean;
  isExpanded: boolean;
  parentId?: string;
  children?: SubChannel[];
  createdAt?: string;
  updatedAt?: string;
}

/** 历史数据点（按天记录总资产）。额外字段用于兼容旧版更丰富的快照数据。 */
export interface HistoryPoint {
  id?: string;
  name?: string;
  date: string; // YYYY-MM-DD
  timestamp?: number;
  totalAmount: Money;
  channels?: Channel[];
  wealthLevel?: string;
  events?: unknown[];
  marketConditions?: unknown;
  linkedReportId?: string;
}

export type ReportType = 'weekly' | 'monthly' | 'yearly';

/** 渠道在报告中的份额快照。 */
export interface ReportChannelDetail {
  id: string;
  name: string;
  emoji: string;
  amount: Money;
  isParent: boolean;
  children: { id: string; name: string; amount: Money }[];
  percentage: number;
}

/** 财务报告（周/月/年报）。大量可选字段用于兼容旧版报告的完整快照数据。 */
export interface FinancialReport {
  id: string;
  reportType: ReportType;
  startDate: string;
  endDate: string;
  title: string;
  totalAmount: Money;
  changeAmount: Money;
  changePercentage: number;
  // 周期变化量/变化率（旧版分别存 weekly/monthly/yearly 前缀字段）
  weeklyChange?: Money;
  weeklyChangePercentage?: number;
  monthlyChange?: Money;
  monthlyChangePercentage?: number;
  yearlyChange?: Money;
  yearlyChangePercentage?: number;
  previousTotalAmount?: Money;
  // 周期极值/均值
  weeklyMax?: Money;
  weeklyMin?: Money;
  weeklyAvg?: Money;
  monthlyMax?: Money;
  monthlyMin?: Money;
  monthlyAvg?: Money;
  yearlyMax?: Money;
  yearlyMin?: Money;
  yearlyAvg?: Money;
  // 周期定位与计数
  year?: number;
  monthNumber?: number;
  weekNumber?: number;
  weeklyReportsCount?: number;
  monthlyReportsCount?: number;
  historyPointsCount?: number;
  // 快照与摘要
  channels?: Channel[];
  /** 旧版历史只有总资产、无渠道快照时为 true（报告无法还原该日期渠道构成）。 */
  channelSnapshotMissing?: boolean;
  channelDetails: ReportChannelDetail[];
  topChannels?: { name: string; emoji: string; amount: Money; percentage: number }[];
  summary?: string;
  generatedAt?: string;
  // 财富等级信息
  wealthLevel?: string;
  wealthLevelName?: string;
  wealthLevelTheme?: string;
  wealthLevelColor?: string;
  // 归档状态
  isArchived: boolean;
  archivedAt?: string;
  archiveNote?: string;
  createdAt: string;

  // —— v1.3 Report Domain（可选，向后兼容旧备份）——
  /** 报告 schema 版本（v1.3 起为 2）。 */
  reportSchemaVersion?: number;
  /** 报告视觉渲染器版本（用于未来重渲染磁盘 HTML/图片）。 */
  reportRendererVersion?: number;
  /** 规范化完成时间（仅首次 normalize 写入，保证 normalize 幂等）。 */
  reportNormalizedAt?: string;
  /** 统一周期 key，如 weekly:2026-W40 / monthly:2026-10 / yearly:2026。 */
  periodKey?: string;
  /** ISO 周编号（周报）。 */
  isoWeek?: number;
  /** ISO 周年份（周报）。 */
  isoWeekYear?: number;
  /** 数据完整度 0-100（报告历史数据完整度，非投资质量）。 */
  dataCompleteness?: number;
  /** 数据完整度标签。 */
  dataCompletenessLabel?: '完整' | '部分完整' | '旧版有限数据';
  /** 数据缺失/限制说明。 */
  dataWarnings?: string[];
  /** 生成该报告时的 App 版本。 */
  sourceVersion?: string;
  /** 同周期报告的修订号（第 1 次生成 = 1）。 */
  revision?: number;
  /** 最后更新时间（同周期更新时刷新）。 */
  updatedAt?: string;
  /** 旧版未知字段透传（升级时保留，不丢弃用户数据）。 */
  legacyMetadata?: Record<string, unknown>;
}

export type SortDirection = 'asc' | 'desc';

/** 自定义排序规则。 */
export interface CustomSortRule {
  id: string;
  key: string;
  label: string;
  description?: string;
  field: string;
  direction: SortDirection;
  category: string;
  tags: string[];
  isSystem?: boolean;
  createdAt?: string;
}

/** 自定义排序规则集合的存储形状（与旧版保持一致）。 */
export interface CustomSortRules {
  rules: CustomSortRule[];
}

/** 排序历史（记录用户最近使用的排序方式）。 */
export interface SortHistory {
  history: { key: string; label: string; timestamp: string }[];
}

export interface CountdownData {
  targetAmount: Money;
  targetDate: string; // YYYY-MM-DD（向后兼容）
  startDate: string; // YYYY-MM-DD（向后兼容）
  /** 目标名称（可选）。 */
  targetName?: string;
  /** IANA 时区（如 Asia/Shanghai）。 */
  timezone?: string;
  /** 起始日期时间（含时间，YYYY-MM-DDTHH:mm）。 */
  startDateTime?: string;
  /** 目标日期时间（含时间）。 */
  targetDateTime?: string;
  /** 起始绝对时间戳（ms）。 */
  startInstant?: number;
  /** 目标绝对时间戳（ms）。 */
  targetInstant?: number;
  /** 显示格式。 */
  displayMode?: 'calendar' | 'days' | 'hours' | 'simple';
  /** 是否显示秒。 */
  showSeconds?: boolean;
}

export interface CountdownProgressPoint {
  date: string;
  progress: number; // 0-1
  totalAmount: Money;
}

export type CoinRainIntensity = 'off' | 'low' | 'medium' | 'high';

export interface CoinRainConfig {
  intensity: CoinRainIntensity;
  windStrength: number;
  bounceFactor: number;
  autoCollect: boolean;
  autoCollectDelay: number;
}

export interface ChartSettings {
  showHistoricalData: boolean;
  chartTimeRangeStart?: string;
  enableCustomAxisColor: boolean;
  chartColors: {
    line?: string;
    axis?: string;
    fill?: string;
  };
  // —— v1.2 新增图表控制（向后兼容，均 optional）——
  /** 显示范围。 */
  timeRange?: 'all' | '30' | '90' | '180' | '365' | 'ytd' | 'custom';
  customTimeRangeStart?: string;
  customTimeRangeEnd?: string;
  /** 时间维度聚合。 */
  timeDimension?: 'raw' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  /** 模型训练窗口。 */
  trainingWindow?: 'all' | '90' | '180' | '365' | 'custom';
  customTrainingDays?: number;
  /** 图表样式。 */
  chartStyle?: 'line' | 'line-dots' | 'area' | 'scatter';
  showHistory?: boolean;
  showFitted?: boolean;
  showForecast?: boolean;
  showPredictionBand?: boolean;
  showTarget?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  showDots?: boolean;
  /** Y 轴单位。 */
  yUnit?: 'auto' | 'yuan' | 'thousand' | 'ten-thousand' | 'million';
  /** Y 轴刻度。 */
  yScale?: 'linear' | 'log';
  /** X 轴标签密度。 */
  tickDensity?: 'auto' | 'sparse' | 'normal' | 'dense';
}

export interface GoalAchievementStatus {
  hasAchievedGoal: boolean;
  /** 目标身份 key（由目标金额+日期生成；修改目标后变化，从而可重新触发庆祝）。 */
  goalKey?: string;
  achievedAt?: string;
  achievedTargetAmount?: Money;
}

/** 图表时间区间历史记录（旧版 key: time_range_history）。 */
export interface TimeRangeRecord {
  timeRange: string;
  timeDimension: string;
  label: string;
  timestamp: number;
}
export interface TimeRangeHistory {
  records: TimeRangeRecord[];
}

/** 当前财富等级缓存（旧版 key: current_wealth_level）。 */
export interface CurrentWealthLevel {
  level: string;
  updatedAt?: string;
}

/** 用户个人资料（本地保存，不上传）。 */
export interface UserProfile {
  nickname?: string;
  avatarEmoji?: string;
  signature?: string;
  /** 默认货币（当前固定 CNY）。 */
  defaultCurrency?: 'CNY';
  /** 默认时区（IANA）。 */
  defaultTimezone?: string;
  updatedAt?: string;
}

/** 外观设置。 */
export interface AppearanceSettings {
  themeMode: 'light' | 'system' | 'dark';
  followWealthTheme: boolean;
  animationIntensity: 'off' | 'low' | 'normal' | 'high';
  backgroundOpacity: number; // 0-100
  reduceMotion: 'system' | 'always';
}

/** 本地账户（本地锁，非云账号；密码/PIN 不明文、不进财务 Backup）。 */
export interface LocalAccount {
  username: string;
  displayName: string;
  avatarEmoji: string;
  lockEnabled: boolean;
  lockMethod: 'pin' | 'password';
  /** 自动锁屏分钟数（0 = 不自动锁）。 */
  autoLockMinutes: number;
  /** 启动时是否要求登录。 */
  requireOnLaunch: boolean;
  /** 是否已创建（区别于未设置）。 */
  created: boolean;
}

/** 智能综合排序权重配置。 */
export interface SmartSortConfig {
  amountWeight: number;
  growthWeight: number;
  activityWeight: number;
  updatedAtWeight: number;
  preset?: 'size' | 'growth' | 'recent' | 'balanced';
}

/** 渠道增长（用于增长率排序与智能排序，来自历史快照）。 */
export interface ChannelGrowth {
  id: string;
  /** 相对基准的增长比例（0.068 = +6.8%），无快照时为 null。 */
  g7d: number | null;
  g30d: number | null;
  g90d: number | null;
  g365d: number | null;
}

/** 财富等级的结构化视觉主题 Token（映射到 CSS Variables，全局生效）。 */
export interface LevelTheme {
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  surfaceSoft: string;
  textOnPrimary: string;
  border: string;
  glow: string;
  progressGradient: string;
  heroGradient: string;
  particleColor: string;
  chartAccent: string;
}

/** 财富等级。 */
export interface WealthLevel {
  name: string;
  minAmount: Money;
  maxAmount: Money;
  badge: string;
  color: string;
  description: string;
  /** 主题标识 key（如 green-nature），用作 data-wealth-theme。 */
  theme: string;
  /** 结构化视觉 Token（映射为 CSS Variables）。 */
  tokens: LevelTheme;
  milestones: { percentage: number; name: string; emoji: string }[];
}

export type PredictionModelType =
  | 'linear'
  | 'exponential'
  | 'conservative'
  | 'aggressive'
  | 'hybrid';

/** 预测结果点（isPrediction 标记区别于真实历史点）。 */
export interface PredictionPoint {
  date: string;
  totalAmount: Money;
  isPrediction: boolean;
  modelType: PredictionModelType;
}

/** 预测维度（用于雷达图）。 */
export interface PredictionDimension {
  dimension: string;
  value: number;
  description: string;
  color: string;
}

/** 预测统计摘要（波动率、趋势、置信度）。 */
export interface PredictionStats {
  volatility: number; // 0-1
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number; // 0-1
}

/** 完整导出/导入用的备份结构（version 1.0.0，与旧版兼容）。 */
export interface BackupData {
  version: string;
  exportDate: string;
  appInfo: { name: string; version: string };
  exportType?: string;
  data: {
    wealth_tracker_data: { channels: Channel[]; history: HistoryPoint[] };
    financial_reports: FinancialReport[];
    custom_sort_rules: CustomSortRules;
    countdown_data: CountdownData;
    goal_achievement_status: GoalAchievementStatus;
    countdown_opacity: number;
    // 以下为可选扩展：旧版导出不含这些键，新版导出时附加以便完整往返；
    // 旧版导入时会忽略未知键，不影响兼容性。
    coin_rain_config?: CoinRainConfig;
    chart_settings?: ChartSettings;
    sort_history?: SortHistory;
    time_range_history?: TimeRangeHistory;
    countdown_progress_history?: CountdownProgressPoint[];
    current_wealth_level?: CurrentWealthLevel;
    wealth_tracker_history?: HistoryPoint[];
  };
  metadata?: {
    totalRecords?: Record<string, number>;
    currentLevel?: string;
    totalAmount?: Money;
    [key: string]: unknown;
  };
  reports?: FinancialReport[]; // financial_reports_batch 导出时使用
  totalCount?: number;
}
