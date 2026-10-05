import type {
  BackupData,
  Channel,
  ChartSettings,
  CoinRainConfig,
  CountdownData,
  CountdownProgressPoint,
  CurrentWealthLevel,
  CustomSortRule,
  FinancialReport,
  GoalAchievementStatus,
  Goal,
  HistoryPoint,
  LevelAchievement,
  LotteryState,
  SortHistory,
  SubChannel,
  TimeRangeHistory,
} from '../../types';
import { round2 } from '../../utils/money';
import { randomId } from '../../utils/id';
import { todayString } from '../../utils/date';
import { defaultChannels, defaultCountdownData } from '../../constants/defaults';
import { getLevelByAmount } from '../../constants/levels';
import { defaultLotteryState } from '../../features/lottery/lotteryMath';

export const BACKUP_VERSION = '1.5.0';
export const APP_NAME = '财富成长记';

/** 导出/导入时需要用到的完整应用状态（由 store 提供）。 */
export interface BackupSource {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  sortRules: CustomSortRule[];
  countdown: CountdownData;
  goalAchieved: GoalAchievementStatus;
  countdownOpacity: number;
  coinRainConfig: CoinRainConfig;
  chartSettings: ChartSettings;
  sortHistory: SortHistory;
  timeRangeHistory: TimeRangeHistory;
  countdownProgressHistory: CountdownProgressPoint[];
  currentWealthLevel: CurrentWealthLevel;
  wealthTrackerHistory: HistoryPoint[];
  lottery?: LotteryState;
  goals?: { goals: Goal[]; primaryGoalId: string | null };
  levelAchievements?: LevelAchievement[];
}

/** 解析+归一化后的可导入数据。 */
export interface ImportedData {
  channels: Channel[];
  history: HistoryPoint[];
  reports: FinancialReport[];
  sortRules: CustomSortRule[];
  countdown: CountdownData;
  goalAchieved: GoalAchievementStatus;
  countdownOpacity: number;
  coinRainConfig?: CoinRainConfig;
  chartSettings?: ChartSettings;
  sortHistory?: SortHistory;
  timeRangeHistory?: TimeRangeHistory;
  countdownProgressHistory?: CountdownProgressPoint[];
  currentWealthLevel?: CurrentWealthLevel;
  wealthTrackerHistory?: HistoryPoint[];
  lottery?: LotteryState;
  goals?: { goals: Goal[]; primaryGoalId: string | null };
  levelAchievements?: LevelAchievement[];
}

export type ParseResult =
  | { ok: true; data: ImportedData; version: string; meta: { totalRecords?: Record<string, number>; totalAmount?: number } }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// 归一化辅助（容错：字段缺失/类型错误时回退到安全默认值）
// ---------------------------------------------------------------------------

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function toStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function toBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeSubChannel(raw: unknown, parentId: string): SubChannel {
  const r = isRecord(raw) ? raw : {};
  return {
    id: toStr(r.id, randomId('sub')),
    name: toStr(r.name, '未命名渠道'),
    emoji: toStr(r.emoji, '💰'),
    amount: round2(toNumber(r.amount, 0)),
    color: toStr(r.color, '#06B6D4'),
    parentId: toStr(r.parentId, parentId),
  };
}

function normalizeChannel(raw: unknown): Channel {
  const r = isRecord(raw) ? raw : {};
  const id = toStr(r.id, randomId('channel'));
  const rawChildren = toArray(r.children);
  const children = rawChildren.length
    ? rawChildren.map((c) => normalizeSubChannel(c, id))
    : undefined;
  return {
    id,
    name: toStr(r.name, '未命名渠道'),
    emoji: toStr(r.emoji, '🏦'),
    amount: round2(toNumber(r.amount, 0)),
    color: toStr(r.color, '#3B82F6'),
    isParent: toBool(r.isParent, true),
    isExpanded: toBool(r.isExpanded, false),
    ...(r.parentId !== undefined ? { parentId: toStr(r.parentId, '') } : {}),
    ...(children ? { children } : {}),
    ...(r.createdAt !== undefined ? { createdAt: toStr(r.createdAt, '') } : {}),
    ...(r.updatedAt !== undefined ? { updatedAt: toStr(r.updatedAt, '') } : {}),
  };
}

function normalizeHistoryPoint(raw: unknown): HistoryPoint | null {
  const r = isRecord(raw) ? raw : {};
  const date = toStr(r.date, '');
  if (!date) return null;
  const point: HistoryPoint = {
    date,
    totalAmount: round2(toNumber(r.totalAmount, 0)),
  };
  if (r.id !== undefined) point.id = toStr(r.id, '');
  if (r.name !== undefined) point.name = toStr(r.name, '');
  if (r.timestamp !== undefined) point.timestamp = toNumber(r.timestamp, 0);
  if (r.wealthLevel !== undefined) point.wealthLevel = toStr(r.wealthLevel, '');
  if (r.linkedReportId !== undefined) point.linkedReportId = toStr(r.linkedReportId, '');
  if (Array.isArray(r.channels)) point.channels = r.channels.map(normalizeChannel);
  if (Array.isArray(r.events)) point.events = r.events;
  if (r.marketConditions !== undefined) point.marketConditions = r.marketConditions;
  return point;
}

function normalizeChannelDetail(raw: unknown): FinancialReport['channelDetails'][number] | null {
  if (!isRecord(raw)) return null;
  const id = toStr(raw.id, '');
  if (!id) return null;
  return {
    id,
    name: toStr(raw.name, '未命名渠道'),
    emoji: toStr(raw.emoji, '💰'),
    amount: round2(toNumber(raw.amount, 0)),
    isParent: toBool(raw.isParent, false),
    children: toArray(raw.children)
      .filter(isRecord)
      .map((c) => ({ id: toStr(c.id, ''), name: toStr(c.name, ''), amount: round2(toNumber(c.amount, 0)) })),
    percentage: toNumber(raw.percentage, 0),
  };
}

function normalizeAssetComposition(raw: unknown): FinancialReport['assetComposition'] | undefined {
  if (!isRecord(raw)) return undefined;
  const parents = toArray(raw.parents)
    .filter(isRecord)
    .map((p) => ({
      id: toStr(p.id, ''),
      name: toStr(p.name, '未命名渠道'),
      emoji: toStr(p.emoji, '💰'),
      amount: round2(toNumber(p.amount, 0)),
      ...(p.color !== undefined ? { color: toStr(p.color, '') } : {}),
      percentageOfTotal: toNumber(p.percentageOfTotal, 0),
      children: toArray(p.children)
        .filter(isRecord)
        .map((c) => ({
          id: toStr(c.id, ''),
          name: toStr(c.name, ''),
          emoji: toStr(c.emoji, '💰'),
          amount: round2(toNumber(c.amount, 0)),
          ...(c.color !== undefined ? { color: toStr(c.color, '') } : {}),
          percentageOfParent: toNumber(c.percentageOfParent, 0),
          percentageOfTotal: toNumber(c.percentageOfTotal, 0),
        })),
    }));
  return { parents, totalAmount: round2(toNumber(raw.totalAmount, 0)) };
}

function normalizeReport(raw: unknown): FinancialReport | null {
  const r = isRecord(raw) ? raw : {};
  const id = toStr(r.id, '');
  if (!id) return null;
  const reportType = ['weekly', 'monthly', 'yearly'].includes(toStr(r.reportType))
    ? (toStr(r.reportType) as FinancialReport['reportType'])
    : 'weekly';
  return {
    id,
    reportType,
    startDate: toStr(r.startDate, ''),
    endDate: toStr(r.endDate, ''),
    title: toStr(r.title, '未命名报告'),
    totalAmount: round2(toNumber(r.totalAmount, 0)),
    changeAmount: round2(toNumber(r.changeAmount, 0)),
    changePercentage: toNumber(r.changePercentage, 0),
    ...(r.weeklyChange !== undefined ? { weeklyChange: toNumber(r.weeklyChange, 0) } : {}),
    ...(r.weeklyChangePercentage !== undefined ? { weeklyChangePercentage: toNumber(r.weeklyChangePercentage, 0) } : {}),
    ...(r.monthlyChange !== undefined ? { monthlyChange: toNumber(r.monthlyChange, 0) } : {}),
    ...(r.monthlyChangePercentage !== undefined ? { monthlyChangePercentage: toNumber(r.monthlyChangePercentage, 0) } : {}),
    ...(r.yearlyChange !== undefined ? { yearlyChange: toNumber(r.yearlyChange, 0) } : {}),
    ...(r.yearlyChangePercentage !== undefined ? { yearlyChangePercentage: toNumber(r.yearlyChangePercentage, 0) } : {}),
    ...(r.previousTotalAmount !== undefined ? { previousTotalAmount: toNumber(r.previousTotalAmount, 0) } : {}),
    ...(r.year !== undefined ? { year: toNumber(r.year, 0) } : {}),
    ...(r.monthNumber !== undefined ? { monthNumber: toNumber(r.monthNumber, 0) } : {}),
    ...(r.weekNumber !== undefined ? { weekNumber: toNumber(r.weekNumber, 0) } : {}),
    ...(r.historyPointsCount !== undefined ? { historyPointsCount: toNumber(r.historyPointsCount, 0) } : {}),
    ...(r.summary !== undefined ? { summary: toStr(r.summary, '') } : {}),
    ...(r.generatedAt !== undefined ? { generatedAt: toStr(r.generatedAt, '') } : {}),
    ...(r.wealthLevel !== undefined ? { wealthLevel: toStr(r.wealthLevel, '') } : {}),
    ...(r.wealthLevelName !== undefined ? { wealthLevelName: toStr(r.wealthLevelName, '') } : {}),
    ...(r.wealthLevelTheme !== undefined ? { wealthLevelTheme: toStr(r.wealthLevelTheme, '') } : {}),
    ...(r.wealthLevelColor !== undefined ? { wealthLevelColor: toStr(r.wealthLevelColor, '') } : {}),
    ...(Array.isArray(r.channels) ? { channels: r.channels.map(normalizeChannel) } : {}),
    channelDetails: toArray(r.channelDetails)
      .map(normalizeChannelDetail)
      .filter((d): d is FinancialReport['channelDetails'][number] => d !== null),
    ...(Array.isArray(r.topChannels) ? { topChannels: r.topChannels } : {}),
    isArchived: toBool(r.isArchived, false),
    ...(r.archivedAt !== undefined ? { archivedAt: toStr(r.archivedAt, '') } : {}),
    ...(r.archiveNote !== undefined ? { archiveNote: toStr(r.archiveNote, '') } : {}),
    createdAt: toStr(r.createdAt, new Date().toISOString()),
    // v1.3+ 字段
    ...(r.periodKey !== undefined ? { periodKey: toStr(r.periodKey, '') } : {}),
    ...(r.revision !== undefined ? { revision: toNumber(r.revision, 1) } : {}),
    ...(r.updatedAt !== undefined ? { updatedAt: toStr(r.updatedAt, '') } : {}),
    ...(r.reportSchemaVersion !== undefined ? { reportSchemaVersion: toNumber(r.reportSchemaVersion, 2) } : {}),
    ...(r.dataCompleteness !== undefined ? { dataCompleteness: toNumber(r.dataCompleteness, 0) } : {}),
    ...(r.dataWarnings !== undefined ? { dataWarnings: toArray(r.dataWarnings).map((w) => toStr(w, '')) } : {}),
    ...(r.sourceVersion !== undefined ? { sourceVersion: toStr(r.sourceVersion, '') } : {}),
    // v1.4 字段
    ...(r.titleMode !== undefined ? { titleMode: (r.titleMode === 'custom' ? 'custom' : 'auto') as FinancialReport['titleMode'] } : {}),
    ...(r.standardTitle !== undefined ? { standardTitle: toStr(r.standardTitle, '') } : {}),
    ...(r.customTitle !== undefined ? { customTitle: toStr(r.customTitle, '') } : {}),
    ...(Array.isArray(r.tags) ? { tags: r.tags.map((t) => toStr(t, '')) } : {}),
    ...(r.customSummary !== undefined ? { customSummary: toStr(r.customSummary, '') } : {}),
    ...(r.copyOfReportId !== undefined ? { copyOfReportId: toStr(r.copyOfReportId, '') } : {}),
    ...(isRecord(r.fieldProvenance) ? { fieldProvenance: r.fieldProvenance as FinancialReport['fieldProvenance'] } : {}),
    ...(Array.isArray(r.repairAudit)
      ? { repairAudit: r.repairAudit.filter(isRecord).map((a) => ({
          field: toStr(a.field, ''),
          oldValue: a.oldValue,
          newValue: a.newValue,
          reason: toStr(a.reason, ''),
          source: toStr(a.source, 'manual-repair') as NonNullable<FinancialReport['repairAudit']>[number]['source'],
          repairedAt: toStr(a.repairedAt, ''),
        })) }
      : {}),
    // v1.5 字段
    ...(isRecord(r.assetComposition) ? { assetComposition: normalizeAssetComposition(r.assetComposition) } : {}),
    ...(r.dataAsOf !== undefined ? { dataAsOf: toStr(r.dataAsOf, '') } : {}),
    ...(r.generationSource !== undefined
      ? { generationSource: (['normal', 'legacy-txt-import', 'legacy-image-import', 'historical-backfill'].includes(toStr(r.generationSource))
          ? toStr(r.generationSource)
          : 'normal') as FinancialReport['generationSource'] }
      : {}),
    ...(Array.isArray(r.compositionWarnings) ? { compositionWarnings: r.compositionWarnings.map((w) => toStr(w, '')) } : {}),
  };
}

function normalizeSortRule(raw: unknown): CustomSortRule | null {
  const r = isRecord(raw) ? raw : {};
  const key = toStr(r.key, '');
  if (!key) return null;
  return {
    id: toStr(r.id, randomId('rule')),
    key,
    label: toStr(r.label, key),
    ...(r.description !== undefined ? { description: toStr(r.description, '') } : {}),
    field: toStr(r.field, 'amount'),
    direction: r.direction === 'asc' ? 'asc' : 'desc',
    category: toStr(r.category, '其他'),
    tags: toArray(r.tags).map((t) => toStr(t, '')),
    ...(r.isSystem !== undefined ? { isSystem: toBool(r.isSystem, false) } : {}),
    ...(r.createdAt !== undefined ? { createdAt: toStr(r.createdAt, '') } : {}),
  };
}

function normalizeLotteryTransaction(raw: unknown): LotteryState['transactions'][number] | null {
  const r = isRecord(raw) ? raw : {};
  const type = ['capital-injection', 'capital-withdrawal', 'stake', 'prize', 'adjustment'].includes(toStr(r.type))
    ? (toStr(r.type) as LotteryState['transactions'][number]['type'])
    : null;
  if (!type) return null;
  return {
    id: toStr(r.id, randomId('ltx')),
    projectId: r.projectId === null || r.projectId === undefined ? null : toStr(r.projectId, ''),
    occurredAt: toStr(r.occurredAt, new Date().toISOString()),
    type,
    amount: Math.abs(round2(toNumber(r.amount, 0))),
    ...(r.direction !== undefined ? { direction: (toNumber(r.direction, 1) >= 0 ? 1 : -1) as 1 | -1 } : {}),
    ...(r.paymentMethod !== undefined ? { paymentMethod: toStr(r.paymentMethod, '') } : {}),
    ...(r.description !== undefined ? { description: toStr(r.description, '') } : {}),
    ...(r.status !== undefined ? { status: toStr(r.status, '') } : {}),
    ...(r.notes !== undefined ? { notes: toStr(r.notes, '') } : {}),
    source: ['manual', 'excel-lottery', 'legacy-import'].includes(toStr(r.source))
      ? (toStr(r.source) as LotteryState['transactions'][number]['source'])
      : 'manual',
    ...(r.importFingerprint !== undefined ? { importFingerprint: toStr(r.importFingerprint, '') } : {}),
    createdAt: toStr(r.createdAt, new Date().toISOString()),
    updatedAt: toStr(r.updatedAt, new Date().toISOString()),
  };
}

function normalizeLotteryProject(raw: unknown): LotteryState['projects'][number] | null {
  const r = isRecord(raw) ? raw : {};
  const id = toStr(r.id, '');
  if (!id) return null;
  return {
    id,
    name: toStr(r.name, '未命名项目'),
    category: ['sports-football', 'lotto', 'other'].includes(toStr(r.category))
      ? (toStr(r.category) as LotteryState['projects'][number]['category'])
      : 'other',
    ...(r.startDate !== undefined ? { startDate: toStr(r.startDate, '') } : {}),
    ...(r.endDate !== undefined ? { endDate: toStr(r.endDate, '') } : {}),
    status: ['active', 'closed', 'archived'].includes(toStr(r.status))
      ? (toStr(r.status) as LotteryState['projects'][number]['status'])
      : 'active',
    ...(r.emoji !== undefined ? { emoji: toStr(r.emoji, '') } : {}),
    ...(r.notes !== undefined ? { notes: toStr(r.notes, '') } : {}),
    dataCompleteness: toStr(r.dataCompleteness, 'detailed') === 'summary-only' ? 'summary-only' : 'detailed',
    ...(isRecord(r.legacySummary)
      ? { legacySummary: { income: round2(toNumber(r.legacySummary.income, 0)), expense: round2(toNumber(r.legacySummary.expense, 0)), netProfitLoss: round2(toNumber(r.legacySummary.netProfitLoss, 0)) } }
      : {}),
    createdAt: toStr(r.createdAt, new Date().toISOString()),
    updatedAt: toStr(r.updatedAt, new Date().toISOString()),
  };
}

function normalizeLotteryState(raw: unknown): LotteryState {
  if (!isRecord(raw)) return defaultLotteryState();
  const pool = isRecord(raw.pool)
    ? {
        id: toStr(raw.pool.id, 'lottery_pool'),
        name: toStr(raw.pool.name, '彩票资金池'),
        openingBalance: round2(toNumber(raw.pool.openingBalance, 0)),
        createdAt: toStr(raw.pool.createdAt, new Date().toISOString()),
        ...(raw.pool.notes !== undefined ? { notes: toStr(raw.pool.notes, '') } : {}),
      }
    : defaultLotteryState().pool;
  return {
    pool,
    projects: toArray(raw.projects).map(normalizeLotteryProject).filter((p): p is LotteryState['projects'][number] => p !== null),
    transactions: toArray(raw.transactions).map(normalizeLotteryTransaction).filter((t): t is LotteryState['transactions'][number] => t !== null),
    settings: isRecord(raw.settings)
      ? { showLotteryAppendix: toBool(raw.settings.showLotteryAppendix, false) }
      : { showLotteryAppendix: false },
  };
}

// ---------------------------------------------------------------------------
// 构建备份
// ---------------------------------------------------------------------------

/** 把当前状态打包成与旧版兼容的备份结构。 */
export function buildBackup(src: BackupSource): BackupData {
  const totalAmount = src.channels.reduce((acc, c) => acc + (c.amount || 0), 0);
  const currentLevel = getLevelByAmount(totalAmount);
  return {
    version: BACKUP_VERSION,
    exportDate: new Date().toISOString(),
    appInfo: { name: APP_NAME, version: BACKUP_VERSION },
    data: {
      wealth_tracker_data: { channels: src.channels, history: src.history },
      financial_reports: src.reports,
      custom_sort_rules: { rules: src.sortRules },
      countdown_data: src.countdown,
      goal_achievement_status: src.goalAchieved,
      countdown_opacity: src.countdownOpacity,
      coin_rain_config: src.coinRainConfig,
      chart_settings: src.chartSettings,
      sort_history: src.sortHistory,
      time_range_history: src.timeRangeHistory,
      countdown_progress_history: src.countdownProgressHistory,
      current_wealth_level: src.currentWealthLevel,
      wealth_tracker_history: src.wealthTrackerHistory,
      lottery_state: src.lottery,
      goals: src.goals,
      level_achievements: src.levelAchievements,
    },
    metadata: {
      totalRecords: {
        channels: src.channels.length,
        history: src.history.length,
        financial_reports: src.reports.length,
      },
      currentLevel: currentLevel.name,
      totalAmount: round2(totalAmount),
    },
  };
}

// ---------------------------------------------------------------------------
// 解析 + 归一化 + 迁移
// ---------------------------------------------------------------------------

/**
 * 解析备份 JSON 字符串，做 schema 校验、字段归一化与版本迁移。
 * 兼容旧版导出的所有字段；未知字段会被忽略（向前兼容）。
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON 格式' };
  }
  if (!isRecord(raw)) return { ok: false, error: '备份根节点格式不正确' };

  // 旧版校验顺序：先 data.wealth_tracker_data，再 version / appInfo。
  const data = isRecord(raw.data) ? raw.data : {};
  const wtd = isRecord(data.wealth_tracker_data) ? data.wealth_tracker_data : undefined;
  if (!wtd) return { ok: false, error: '文件格式不正确，不是有效的备份文件（缺少 wealth_tracker_data）' };

  const version = toStr(raw.version, BACKUP_VERSION);
  // 未来版本号高于当前时，仍尝试导入核心数据（向前兼容），但保留提示信息。
  if (!raw.version) {
    // 旧版导出一定带 version；缺失则视为极早期版本，仍按 1.0.0 处理。
  }

  const channels = toArray(wtd.channels).map(normalizeChannel);
  const history = toArray(wtd.history)
    .map(normalizeHistoryPoint)
    .filter((p): p is HistoryPoint => p !== null);

  const reports = toArray(data.financial_reports)
    .map(normalizeReport)
    .filter((r): r is FinancialReport => r !== null);

  const rulesRaw = isRecord(data.custom_sort_rules) ? data.custom_sort_rules : undefined;
  const sortRules = toArray(rulesRaw?.rules).map(normalizeSortRule).filter((r): r is CustomSortRule => r !== null);

  const cdRaw = isRecord(data.countdown_data) ? data.countdown_data : undefined;
  const countdown: CountdownData = cdRaw
    ? {
        targetAmount: toNumber(cdRaw.targetAmount, 1_000_000),
        targetDate: toStr(cdRaw.targetDate, todayString()),
        startDate: toStr(cdRaw.startDate, todayString()),
        ...(cdRaw.targetName !== undefined ? { targetName: toStr(cdRaw.targetName, '') } : {}),
        ...(cdRaw.timezone !== undefined ? { timezone: toStr(cdRaw.timezone, '') } : {}),
        ...(cdRaw.startDateTime !== undefined ? { startDateTime: toStr(cdRaw.startDateTime, '') } : {}),
        ...(cdRaw.targetDateTime !== undefined ? { targetDateTime: toStr(cdRaw.targetDateTime, '') } : {}),
        ...(cdRaw.startInstant !== undefined ? { startInstant: toNumber(cdRaw.startInstant, 0) } : {}),
        ...(cdRaw.targetInstant !== undefined ? { targetInstant: toNumber(cdRaw.targetInstant, 0) } : {}),
        ...(cdRaw.displayMode !== undefined
          ? { displayMode: (['calendar', 'days', 'hours', 'simple'] as const).includes(toStr(cdRaw.displayMode) as never) ? (toStr(cdRaw.displayMode) as CountdownData['displayMode']) : 'calendar' }
          : {}),
        ...(cdRaw.showSeconds !== undefined ? { showSeconds: toBool(cdRaw.showSeconds, false) } : {}),
      }
    : defaultCountdownData();

  const goalRaw = isRecord(data.goal_achievement_status) ? data.goal_achievement_status : undefined;
  const goalAchieved: GoalAchievementStatus = {
    hasAchievedGoal: toBool(goalRaw?.hasAchievedGoal, false),
    ...(goalRaw?.goalKey !== undefined ? { goalKey: toStr(goalRaw.goalKey, '') } : {}),
    ...(goalRaw?.achievedAt !== undefined ? { achievedAt: toStr(goalRaw.achievedAt, '') } : {}),
    ...(goalRaw?.achievedTargetAmount !== undefined ? { achievedTargetAmount: toNumber(goalRaw.achievedTargetAmount, 0) } : {}),
  };

  const countdownOpacity = toNumber(data.countdown_opacity, 1);

  const imported: ImportedData = {
    channels,
    history,
    reports,
    sortRules,
    countdown,
    goalAchieved,
    countdownOpacity,
  };

  if (isRecord(data.coin_rain_config)) {
    imported.coinRainConfig = {
      intensity: ['low', 'medium', 'high'].includes(toStr(data.coin_rain_config.intensity, 'medium'))
        ? (data.coin_rain_config.intensity as CoinRainConfig['intensity'])
        : 'medium',
      windStrength: toNumber(data.coin_rain_config.windStrength, 0.5),
      bounceFactor: toNumber(data.coin_rain_config.bounceFactor, 0.6),
      autoCollect: toBool(data.coin_rain_config.autoCollect, true),
      autoCollectDelay: toNumber(data.coin_rain_config.autoCollectDelay, 4000),
    };
  }
  if (isRecord(data.chart_settings)) {
    imported.chartSettings = {
      showHistoricalData: toBool(data.chart_settings.showHistoricalData, true),
      ...(data.chart_settings.chartTimeRangeStart !== undefined
        ? { chartTimeRangeStart: toStr(data.chart_settings.chartTimeRangeStart, '') }
        : {}),
      enableCustomAxisColor: toBool(data.chart_settings.enableCustomAxisColor, false),
      chartColors: isRecord(data.chart_settings.chartColors) ? { ...data.chart_settings.chartColors } : {},
      ...(data.chart_settings.timeRange !== undefined ? { timeRange: toStr(data.chart_settings.timeRange) as ChartSettings['timeRange'] } : {}),
      ...(data.chart_settings.timeDimension !== undefined ? { timeDimension: toStr(data.chart_settings.timeDimension) as ChartSettings['timeDimension'] } : {}),
      ...(data.chart_settings.trainingWindow !== undefined ? { trainingWindow: toStr(data.chart_settings.trainingWindow) as ChartSettings['trainingWindow'] } : {}),
      ...(data.chart_settings.chartStyle !== undefined ? { chartStyle: toStr(data.chart_settings.chartStyle) as ChartSettings['chartStyle'] } : {}),
      showHistory: data.chart_settings.showHistory !== undefined ? toBool(data.chart_settings.showHistory, true) : undefined,
      showFitted: data.chart_settings.showFitted !== undefined ? toBool(data.chart_settings.showFitted, true) : undefined,
      showForecast: data.chart_settings.showForecast !== undefined ? toBool(data.chart_settings.showForecast, true) : undefined,
      showPredictionBand: data.chart_settings.showPredictionBand !== undefined ? toBool(data.chart_settings.showPredictionBand, true) : undefined,
      showTarget: data.chart_settings.showTarget !== undefined ? toBool(data.chart_settings.showTarget, true) : undefined,
      showGrid: data.chart_settings.showGrid !== undefined ? toBool(data.chart_settings.showGrid, true) : undefined,
      showLegend: data.chart_settings.showLegend !== undefined ? toBool(data.chart_settings.showLegend, true) : undefined,
      showDots: data.chart_settings.showDots !== undefined ? toBool(data.chart_settings.showDots, false) : undefined,
      ...(data.chart_settings.yUnit !== undefined ? { yUnit: toStr(data.chart_settings.yUnit) as ChartSettings['yUnit'] } : {}),
      ...(data.chart_settings.yScale !== undefined ? { yScale: toStr(data.chart_settings.yScale) as ChartSettings['yScale'] } : {}),
      ...(data.chart_settings.tickDensity !== undefined ? { tickDensity: toStr(data.chart_settings.tickDensity) as ChartSettings['tickDensity'] } : {}),
    } as ChartSettings;
  }
  if (isRecord(data.sort_history)) {
    imported.sortHistory = {
      history: toArray(data.sort_history.history)
        .filter(isRecord)
        .map((h) => ({ key: toStr(h.key, ''), label: toStr(h.label, ''), timestamp: toStr(h.timestamp, '') })),
    };
  }
  if (isRecord(data.time_range_history)) {
    imported.timeRangeHistory = {
      records: toArray(data.time_range_history.records)
        .filter(isRecord)
        .map((h) => ({
          timeRange: toStr(h.timeRange, ''),
          timeDimension: toStr(h.timeDimension, ''),
          label: toStr(h.label, ''),
          timestamp: toNumber(h.timestamp, 0),
        })),
    };
  }
  if (Array.isArray(data.countdown_progress_history)) {
    imported.countdownProgressHistory = data.countdown_progress_history
      .filter(isRecord)
      .map((p) => ({ date: toStr(p.date, ''), progress: toNumber(p.progress, 0), totalAmount: toNumber(p.totalAmount, 0) }));
  }
  if (isRecord(data.current_wealth_level)) {
    imported.currentWealthLevel = { level: toStr(data.current_wealth_level.level, '') };
  }
  if (Array.isArray(data.wealth_tracker_history)) {
    imported.wealthTrackerHistory = data.wealth_tracker_history
      .map(normalizeHistoryPoint)
      .filter((p): p is HistoryPoint => p !== null);
  }
  if (data.lottery_state !== undefined) {
    imported.lottery = normalizeLotteryState(data.lottery_state);
  }
  if (isRecord(data.goals)) {
    imported.goals = {
      goals: toArray(data.goals.goals)
        .filter(isRecord)
        .map((g) => ({
          id: toStr(g.id, randomId('goal')),
          name: toStr(g.name, '财富目标'),
          icon: toStr(g.icon, '🎯'),
          targetAmount: round2(toNumber(g.targetAmount, 0)),
          startDateTime: toStr(g.startDateTime, todayString() + 'T00:00'),
          targetDateTime: toStr(g.targetDateTime, todayString() + 'T00:00'),
          timezone: toStr(g.timezone, 'Asia/Shanghai'),
          displayMode: ['calendar', 'days', 'hours', 'simple'].includes(toStr(g.displayMode)) ? (toStr(g.displayMode) as Goal['displayMode']) : 'calendar',
          status: ['not-started', 'active', 'achieved', 'expired', 'archived'].includes(toStr(g.status)) ? (toStr(g.status) as Goal['status']) : 'active',
          priority: toNumber(g.priority, 0),
          color: toStr(g.color, '#3B82F6'),
          showSeconds: toBool(g.showSeconds, true),
          createdAt: toStr(g.createdAt, new Date().toISOString()),
          updatedAt: toStr(g.updatedAt, new Date().toISOString()),
          ...(g.achievedAt !== undefined ? { achievedAt: toStr(g.achievedAt, '') } : {}),
          ...(g.archivedAt !== undefined ? { archivedAt: toStr(g.archivedAt, '') } : {}),
          ...(g.notes !== undefined ? { notes: toStr(g.notes, '') } : {}),
        })),
      primaryGoalId: data.goals.primaryGoalId != null ? toStr(data.goals.primaryGoalId, '') : null,
    };
  }
  if (Array.isArray(data.level_achievements)) {
    imported.levelAchievements = data.level_achievements.filter(isRecord).map((a) => ({
      levelId: toStr(a.levelId, ''),
      levelName: toStr(a.levelName, ''),
      reachedAt: toStr(a.reachedAt, ''),
      firstAmount: round2(toNumber(a.firstAmount, 0)),
      ...(a.unknownTime !== undefined ? { unknownTime: toBool(a.unknownTime, false) } : {}),
    }));
  }

  const metaRaw = isRecord(raw.metadata) ? raw.metadata : undefined;
  const meta = {
    totalRecords: isRecord(metaRaw?.totalRecords) ? (metaRaw.totalRecords as Record<string, number>) : undefined,
    totalAmount: metaRaw?.totalAmount !== undefined ? toNumber(metaRaw.totalAmount, 0) : undefined,
  };

  return { ok: true, data: imported, version, meta };
}

/** 首次启动时使用的空数据（用于「无任何已存数据」时的初始化）。 */
export function emptyImportedData(): ImportedData {
  return {
    channels: defaultChannels(),
    history: [{ date: todayString(), totalAmount: 0 }],
    reports: [],
    sortRules: [],
    countdown: defaultCountdownData(),
    goalAchieved: { hasAchievedGoal: false },
    countdownOpacity: 1,
  };
}
