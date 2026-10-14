import { REPORT_RENDERER_VERSION, REPORT_SCHEMA_VERSION } from '../../features/reports/normalize';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

function numericFields(value: Record<string, unknown>, fields: string[], context: string, required = false): void {
  for (const field of fields) {
    if ((required || value[field] !== undefined) && !amount(value[field])) throw new Error(`${context}字段 ${field} 金额或数值无效`);
  }
}

function validateChannels(channels: unknown, context: string): void {
  if (!Array.isArray(channels)) throw new Error(`${context}渠道结构无效`);
  for (const channel of channels) {
    if (!record(channel) || typeof channel.id !== 'string' || !channel.id || !amount(channel.amount)) throw new Error(`${context}渠道 ID 或金额无效`);
    if (channel.children !== undefined) validateChannels(channel.children, context);
  }
}

function validateDetails(details: unknown, context: string): void {
  if (!Array.isArray(details)) throw new Error(`${context}构成结构无效`);
  for (const detail of details) {
    if (!record(detail)) throw new Error(`${context}构成结构无效`);
    numericFields(detail, ['amount'], context, true);
    numericFields(detail, ['percentage', 'percentageOfParent', 'percentageOfTotal'], context);
    if (detail.children !== undefined) validateDetails(detail.children, context);
  }
}

/** Validation runs before normalization so corrupt financial facts cannot become zero. */
export function validateLedgerShape(ledger: unknown, reports: unknown): void {
  if (ledger !== null) {
    if (!record(ledger) || !Array.isArray(ledger.channels) || !Array.isArray(ledger.history)) throw new Error('资产主数据结构无效');
    validateChannels(ledger.channels, '资产');
    for (const point of ledger.history) {
      if (!record(point) || !date(point.date) || !amount(point.totalAmount)) throw new Error('历史日期或金额无效');
      if (point.channels !== undefined) {
        validateChannels(point.channels, '历史快照');
      }
    }
  }
  if (reports !== null) {
    if (!Array.isArray(reports)) throw new Error('报告列表结构无效');
    for (const report of reports) {
      if (!record(report) || typeof report.id !== 'string' || !date(report.startDate) || !date(report.endDate) ||
          report.startDate > report.endDate || !amount(report.totalAmount)) throw new Error('报告身份、周期或金额无效');
      if (report.reportSchemaVersion !== undefined && (!Number.isSafeInteger(report.reportSchemaVersion) || (report.reportSchemaVersion as number) < 0 || (report.reportSchemaVersion as number) > REPORT_SCHEMA_VERSION)) {
        throw new Error('报告 Schema 来自更新版本或格式无效，当前版本禁止写入');
      }
      if (report.reportRendererVersion !== undefined && (!Number.isSafeInteger(report.reportRendererVersion) || (report.reportRendererVersion as number) < 0 || (report.reportRendererVersion as number) > REPORT_RENDERER_VERSION)) {
        throw new Error('报告 Renderer 来自更新版本或格式无效，当前版本禁止写入');
      }
      numericFields(report, ['previousTotalAmount', 'changeAmount', 'changePercentage',
        'weeklyChange', 'weeklyChangePercentage', 'monthlyChange', 'monthlyChangePercentage', 'yearlyChange', 'yearlyChangePercentage',
        'weeklyMax', 'weeklyMin', 'weeklyAvg', 'monthlyMax', 'monthlyMin', 'monthlyAvg', 'yearlyMax', 'yearlyMin', 'yearlyAvg'], '报告');
      if (report.channels !== undefined) validateChannels(report.channels, '报告快照');
      if (report.channelDetails !== undefined) validateDetails(report.channelDetails, '报告');
      if (report.topChannels !== undefined) validateDetails(report.topChannels, '报告 Top');
      if (report.assetComposition !== undefined) {
        if (!record(report.assetComposition)) throw new Error('报告资产构成无效');
        numericFields(report.assetComposition, ['totalAmount'], '报告资产构成', true);
        validateDetails(report.assetComposition.parents, '报告资产构成');
      }
      if (report.dataAsOf !== undefined && (!date(report.dataAsOf) || report.dataAsOf > report.endDate)) throw new Error('报告数据截至日期无效');
      if (report.baselineStatus !== undefined && !['known', 'unknown'].includes(String(report.baselineStatus))) throw new Error('报告期初基准状态无效');
      if (report.baselineStatus === 'known' && report.previousTotalAmount === undefined) throw new Error('报告标记期初已知但缺少期初金额');
    }
  }
}

/** Optional financial sections must also be checked before fallback normalization. */
export function validateFinancialExtensions(data: Record<string, unknown>): void {
  const section = (name: string, fields: string[]) => {
    const value = data[name];
    if (value === undefined || value === null) return;
    if (!record(value)) throw new Error(`${name} 结构无效`);
    numericFields(value, fields, name);
  };
  section('countdown_data', ['targetAmount']);
  section('goal_achievement_status', ['achievedTargetAmount']);
  const list = (items: unknown, context: string, fields: string[]) => {
    if (items === undefined || items === null) return;
    if (!Array.isArray(items)) throw new Error(`${context} 结构无效`);
    for (const item of items) {
      if (!record(item)) throw new Error(`${context} 记录无效`);
      numericFields(item, fields, context, true);
    }
  };
  if (data.goals !== undefined && data.goals !== null) {
    if (!record(data.goals)) throw new Error('目标结构无效');
    list(data.goals.goals, '目标', ['targetAmount']);
  }
  list(data.level_achievements, '等级成就', ['firstAmount']);
  list(data.countdown_progress_history, '目标进度', ['totalAmount', 'progress']);
  if (data.lottery_state !== undefined && data.lottery_state !== null) {
    const lottery = data.lottery_state;
    if (!record(lottery) || !record(lottery.pool)) throw new Error('彩票资金池结构无效');
    numericFields(lottery.pool, ['openingBalance'], '彩票资金池', true);
    list(lottery.transactions, '彩票交易', ['amount']);
    for (const transaction of (lottery.transactions ?? []) as Record<string, unknown>[]) {
      if ((transaction.amount as number) < 0) throw new Error('彩票交易金额必须非负，方向需单独记录');
    }
    if (lottery.projects !== undefined) {
      if (!Array.isArray(lottery.projects)) throw new Error('彩票项目结构无效');
      for (const project of lottery.projects) {
        if (!record(project)) throw new Error('彩票项目无效');
        if (project.legacySummary !== undefined) {
          if (!record(project.legacySummary)) throw new Error('彩票汇总无效');
          numericFields(project.legacySummary, ['income', 'expense', 'netProfitLoss'], '彩票汇总', true);
        }
      }
    }
  }
}
