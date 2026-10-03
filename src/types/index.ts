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
  targetDate: string; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
}

export interface CountdownProgressPoint {
  date: string;
  progress: number; // 0-1
  totalAmount: Money;
}

export type CoinRainIntensity = 'low' | 'medium' | 'high';

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
}

export interface GoalAchievementStatus {
  hasAchievedGoal: boolean;
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

/** 财富等级。 */
export interface WealthLevel {
  name: string;
  minAmount: Money;
  maxAmount: Money;
  badge: string;
  color: string;
  description: string;
  theme: string;
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
