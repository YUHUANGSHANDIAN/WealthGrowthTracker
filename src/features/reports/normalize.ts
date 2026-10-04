import type { Channel, FinancialReport, ReportChannelDetail, ReportType } from '../../types';
import { getLevelByAmount } from '../../constants/levels';
import { leafChannels } from '../../utils/channels';
import { isoWeekOfYear, pad2, parseDateString } from '../../utils/date';
import { round2 } from '../../utils/money';

/**
 * Report Domain —— 财务报告规范化管线（v1.3）。
 *
 * 核心原则：
 * - 「历史事实」（报告 ID、周期、历史期末/期初总资产、渠道 snapshot、createdAt、归档备注）
 *   绝不因 App 升级而改变。
 * - 「可推导字段」（title / periodKey / year / week / wealthLevel / summary / topChannels /
 *   completeness）在历史数据足够时安全补齐。
 * - 「无法有依据推导的字段」（历史渠道构成、期间极值）缺数据时标记，绝不拿今天的数据冒充过去。
 *
 * 所有函数均为纯函数、确定性、幂等：normalize(normalize(report)) 结果不变。
 */

export const REPORT_SCHEMA_VERSION = 2;
export const REPORT_RENDERER_VERSION = 1;

/** 当前渠道构成报告所需的份额明细（叶子渠道）。 */
export function buildChannelDetails(channels: Channel[], total: number): ReportChannelDetail[] {
  const leaves = leafChannels(channels);
  return leaves.map((l) => ({
    id: l.id,
    name: l.name,
    emoji: l.emoji,
    amount: l.amount,
    isParent: l.parentId === null,
    children: [],
    percentage: total > 0 ? round2((l.amount / total) * 100) : 0,
  }));
}

/** 报告周期 key：weekly:2026-W40 / monthly:2026-10 / yearly:2026。 */
export function periodKeyOf(report: Pick<FinancialReport, 'reportType' | 'startDate' | 'endDate'>): string {
  const end = report.endDate || report.startDate;
  switch (report.reportType) {
    case 'weekly': {
      const { year, week } = isoWeekOfYear(end);
      return `weekly:${year}-W${pad2(week)}`;
    }
    case 'monthly': {
      const d = parseDateString(end);
      return `monthly:${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    }
    case 'yearly':
      return `yearly:${parseDateString(end).getFullYear()}`;
  }
}

/** 依据周期生成标准标题（ISO 周年份 + ISO 周编号）。 */
export function buildTitle(reportType: ReportType, endDate: string): string {
  const d = parseDateString(endDate);
  switch (reportType) {
    case 'weekly': {
      const { year, week } = isoWeekOfYear(endDate);
      return `${year}年第${week}周周度财务报告`;
    }
    case 'monthly':
      return `${d.getFullYear()}年${d.getMonth() + 1}月月度财务报告`;
    case 'yearly':
      return `${d.getFullYear()}年年度财务报告`;
  }
}

/** 从渠道明细推导 TOP 3。 */
export function topChannelsFrom(channelDetails: ReportChannelDetail[]): FinancialReport['topChannels'] {
  if (!channelDetails || channelDetails.length === 0) return undefined;
  return [...channelDetails]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map((c) => ({ name: c.name, emoji: c.emoji, amount: c.amount, percentage: c.percentage }));
}

/** 摘要文案。 */
function buildSummary(report: Pick<FinancialReport, 'totalAmount' | 'changePercentage' | 'wealthLevelName'>): string {
  const pct = report.changePercentage ?? 0;
  const direction = pct >= 0 ? '增长' : '减少';
  const level = report.wealthLevelName ?? '财富等级';
  return `本期总资产 ${report.totalAmount.toFixed(2)} 元，较期初${direction} ${Math.abs(pct).toFixed(1)}%，当前为「${level}」。`;
}

/** 期间极值字段读取（按报告类型）。 */
function extremaOf(report: FinancialReport): { max?: number; min?: number; avg?: number } {
  switch (report.reportType) {
    case 'weekly':
      return { max: report.weeklyMax, min: report.weeklyMin, avg: report.weeklyAvg };
    case 'monthly':
      return { max: report.monthlyMax, min: report.monthlyMin, avg: report.monthlyAvg };
    case 'yearly':
      return { max: report.yearlyMax, min: report.yearlyMin, avg: report.yearlyAvg };
  }
}

export interface ReportCompleteness {
  score: number;
  label: '完整' | '部分完整' | '旧版有限数据';
  warnings: string[];
}

/**
 * 计算报告历史数据完整度（0-100）。表示「报告历史数据完整度」，不是投资质量。
 * - 期末总资产 30 / 期初总资产 10 / 渠道快照 25 / 期间极值 15 / 日序列 10 / 财富等级 10。
 */
export function computeCompleteness(report: FinancialReport): ReportCompleteness {
  let score = 0;
  const warnings: string[] = [];

  if (Number.isFinite(report.totalAmount)) score += 30;
  if (report.previousTotalAmount !== undefined && Number.isFinite(report.previousTotalAmount)) score += 10;
  else warnings.push('缺少期初资产');

  if (!report.channelSnapshotMissing && report.channelDetails.length > 0) score += 25;
  else warnings.push('缺少渠道快照');

  const ext = extremaOf(report);
  if (ext.max !== undefined && ext.min !== undefined && Number.isFinite(ext.max) && Number.isFinite(ext.min)) score += 15;
  else warnings.push('无法计算期间极值');

  if (report.historyPointsCount !== undefined && report.historyPointsCount > 0) score += 10;
  else warnings.push('缺少完整日序列');

  if (report.wealthLevelName || report.wealthLevel) score += 10;

  const label: ReportCompleteness['label'] = score >= 90 ? '完整' : score >= 60 ? '部分完整' : '旧版有限数据';
  return { score, label, warnings };
}

/**
 * 规范化一份财务报告（纯函数、幂等）。
 * 只补齐「可推导」字段；历史事实字段保持原值。
 */
export function normalizeFinancialReport(report: FinancialReport): FinancialReport {
  const endDate = report.endDate || report.startDate;
  const periodKey = report.periodKey ?? periodKeyOf(report);
  const title = report.title?.trim() ? report.title : buildTitle(report.reportType, endDate);

  const d = parseDateString(endDate);
  const iso = report.reportType === 'weekly' ? isoWeekOfYear(endDate) : null;

  // 周期定位字段（仅缺失时推导，不覆盖已有历史事实）
  const year = report.year ?? (report.reportType === 'weekly' ? (iso?.year ?? d.getFullYear()) : d.getFullYear());
  const monthNumber = report.monthNumber ?? (report.reportType === 'monthly' ? d.getMonth() + 1 : undefined);
  const weekNumber = report.weekNumber ?? (report.reportType === 'weekly' ? iso?.week : undefined);
  const isoWeek = report.isoWeek ?? iso?.week;
  const isoWeekYear = report.isoWeekYear ?? iso?.year;

  // 财富等级（从报告自己保存的 totalAmount 推导，安全）
  const level = getLevelByAmount(report.totalAmount);
  const wealthLevel = report.wealthLevel ?? level.name;
  const wealthLevelName = report.wealthLevelName ?? level.name;
  const wealthLevelTheme = report.wealthLevelTheme ?? level.theme;
  const wealthLevelColor = report.wealthLevelColor ?? level.color;

  // 渠道明细：仅在缺失且存在 channels snapshot 时补齐（不拿今天数据冒充）
  let channelDetails = report.channelDetails ?? [];
  let channelSnapshotMissing = report.channelSnapshotMissing;
  if (channelDetails.length === 0 && report.channels && report.channels.length > 0) {
    channelDetails = buildChannelDetails(report.channels, report.totalAmount);
    channelSnapshotMissing = false;
  }

  // TOP 渠道：仅在缺失且有渠道明细时补齐
  const topChannels =
    report.topChannels && report.topChannels.length > 0 ? report.topChannels : topChannelsFrom(channelDetails);

  // 摘要
  const summary = report.summary ?? buildSummary({ totalAmount: report.totalAmount, changePercentage: report.changePercentage, wealthLevelName });

  // 生成时间回退到 createdAt（仅在缺失时）
  const generatedAt = report.generatedAt ?? report.createdAt;

  const completeness = computeCompleteness({ ...report, channelDetails, channelSnapshotMissing, wealthLevelName });

  return {
    ...report,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    reportRendererVersion: report.reportRendererVersion ?? REPORT_RENDERER_VERSION,
    reportNormalizedAt: report.reportNormalizedAt,
    periodKey,
    title,
    year,
    ...(monthNumber !== undefined ? { monthNumber } : {}),
    ...(weekNumber !== undefined ? { weekNumber } : {}),
    ...(isoWeek !== undefined ? { isoWeek } : {}),
    ...(isoWeekYear !== undefined ? { isoWeekYear } : {}),
    wealthLevel,
    wealthLevelName,
    wealthLevelTheme,
    wealthLevelColor,
    channelDetails,
    ...(channelSnapshotMissing ? { channelSnapshotMissing: true } : {}),
    ...(topChannels ? { topChannels } : {}),
    summary,
    generatedAt,
    dataCompleteness: completeness.score,
    dataCompletenessLabel: completeness.label,
    dataWarnings: completeness.warnings,
  };
}

/** 规范化报告数组（映射 normalizeFinancialReport）。 */
export function normalizeFinancialReports(reports: FinancialReport[]): FinancialReport[] {
  return reports.map((r) => normalizeFinancialReport(r));
}

/** 修复别名（语义与 normalize 一致）。 */
export const repairFinancialReport = normalizeFinancialReport;

/** 判断报告是否已达标 v1.3 schema（用于决定是否触发批量升级/备份）。 */
export function needsReportNormalization(report: FinancialReport): boolean {
  return (
    report.reportSchemaVersion !== REPORT_SCHEMA_VERSION ||
    !report.periodKey ||
    report.dataCompleteness === undefined
  );
}

/** 批量规范化，返回 { reports, changed }。 */
export function normalizeAndReport(
  reports: FinancialReport[],
): { reports: FinancialReport[]; changed: number } {
  let changed = 0;
  const normalized = reports.map((r) => {
    const needs = needsReportNormalization(r);
    if (needs) changed++;
    return needs ? normalizeFinancialReport(r) : r;
  });
  return { reports: normalized, changed };
}

/** 百分比展示（供排序/展示统一，保留一位小数）。 */
export function changePct(report: FinancialReport): number {
  return round2(report.changePercentage ?? 0);
}
