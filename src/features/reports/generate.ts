import type {
  Channel,
  FinancialReport,
  HistoryPoint,
  ReportChannelDetail,
  ReportType,
} from '../../types';
import { leafChannels, totalAssets } from '../../utils/channels';
import { round2, diffMoney } from '../../utils/money';
import { getLevelByAmount } from '../../constants/levels';
import {
  parseDateString,
  todayString,
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  yearStart,
  yearEnd,
  weekNumberOfYear,
} from '../../utils/date';
import { randomId } from '../../utils/id';

/** 报告时间范围。 */
export interface PeriodRange {
  startDate: string;
  endDate: string;
}

export function periodRange(reportType: ReportType, referenceDate: string): PeriodRange {
  switch (reportType) {
    case 'weekly':
      return { startDate: weekStart(referenceDate), endDate: weekEnd(referenceDate) };
    case 'monthly':
      return { startDate: monthStart(referenceDate), endDate: monthEnd(referenceDate) };
    case 'yearly':
      return { startDate: yearStart(referenceDate), endDate: yearEnd(referenceDate) };
  }
}

/** 报告标题（与旧版命名风格一致）。 */
export function reportTitle(reportType: ReportType, referenceDate: string): string {
  const d = parseDateString(referenceDate);
  const year = d.getFullYear();
  switch (reportType) {
    case 'weekly':
      return `${year}年第${weekNumberOfYear(referenceDate)}周周度财务报告`;
    case 'monthly':
      return `${year}年${d.getMonth() + 1}月月度财务报告`;
    case 'yearly':
      return `${year}年年度财务报告`;
  }
}

/** 某日期及之前最近一次总资产（不含渠道构成）。 */
export function assetAtDate(history: HistoryPoint[], date: string): number {
  const p = latestPointAtOrBefore(history, date);
  return p ? p.totalAmount : 0;
}

/** 某日期及之前最近的一条历史记录（含渠道快照，若存在）。 */
export function latestPointAtOrBefore(history: HistoryPoint[], date: string): HistoryPoint | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  let candidate: HistoryPoint | null = null;
  for (const p of sorted) {
    if (p.date <= date) candidate = p;
    else break;
  }
  return candidate ?? sorted[0]!;
}

/** 当前渠道构成报告所需的份额明细。 */
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

/**
 * 生成一份周/月/年财务报告（纯函数，可单测）。
 *
 * 准确性原则：
 * - 「当前周期」的期末总资产用当前渠道状态；「过去周期」用该周期末或之前最近一次
 *   HistoryPoint 的总资产作为期末快照。
 * - 渠道构成优先使用历史快照（HistoryPoint.channels）；旧版历史只有总资产、无渠道快照时，
 *   明确标记 channelSnapshotMissing，而非拿今天的数据冒充过去数据。
 */
export function generateReport(
  history: HistoryPoint[],
  reportType: ReportType,
  referenceDate: string,
  currentChannels: Channel[] = [],
  now: string = todayString(),
): FinancialReport {
  const { startDate, endDate } = periodRange(reportType, referenceDate);
  const isCurrentPeriod = endDate >= now;

  const endPoint = latestPointAtOrBefore(history, endDate);
  const startPoint = latestPointAtOrBefore(history, startDate);

  let total: number;
  let endChannels: Channel[] | undefined;
  let channelSnapshotMissing = false;

  if (isCurrentPeriod) {
    total = totalAssets(currentChannels);
    endChannels = currentChannels;
  } else if (endPoint && endPoint.channels && endPoint.channels.length > 0) {
    total = endPoint.totalAmount;
    endChannels = endPoint.channels;
  } else if (endPoint) {
    total = endPoint.totalAmount;
    channelSnapshotMissing = true;
  } else {
    total = 0;
    channelSnapshotMissing = true;
  }

  const previous = startPoint ? startPoint.totalAmount : 0;
  const change = diffMoney(total, previous);
  const changePercentage = previous > 0 ? round2((change / previous) * 100) : 0;

  const inPeriod = history.filter((p) => p.date >= startDate && p.date <= endDate);
  const amounts = inPeriod.map((p) => p.totalAmount);
  const max = amounts.length ? Math.max(...amounts) : total;
  const min = amounts.length ? Math.min(...amounts) : total;
  const avg = amounts.length ? round2(amounts.reduce((a, b) => a + b, 0) / amounts.length) : total;

  const channelDetails = endChannels ? buildChannelDetails(endChannels, total) : [];
  const topChannels = [...channelDetails]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map((c) => ({ name: c.name, emoji: c.emoji, amount: c.amount, percentage: c.percentage }));

  const level = getLevelByAmount(total);
  const d = parseDateString(referenceDate);

  const base = {
    id: randomId('report'),
    reportType,
    startDate,
    endDate,
    title: reportTitle(reportType, referenceDate),
    totalAmount: total,
    previousTotalAmount: previous,
    changeAmount: change,
    changePercentage,
    channelDetails,
    topChannels,
    wealthLevel: level.name,
    wealthLevelName: level.name,
    wealthLevelTheme: level.theme,
    wealthLevelColor: level.color,
    isArchived: false,
    createdAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    historyPointsCount: inPeriod.length,
    year: d.getFullYear(),
    ...(endChannels ? { channels: endChannels } : {}),
    ...(channelSnapshotMissing ? { channelSnapshotMissing: true } : {}),
  };

  switch (reportType) {
    case 'weekly':
      return {
        ...base,
        weeklyChange: change,
        weeklyChangePercentage: changePercentage,
        weeklyMax: max,
        weeklyMin: min,
        weeklyAvg: avg,
        weekNumber: weekNumberOfYear(referenceDate),
      };
    case 'monthly':
      return {
        ...base,
        monthlyChange: change,
        monthlyChangePercentage: changePercentage,
        monthlyMax: max,
        monthlyMin: min,
        monthlyAvg: avg,
        monthNumber: d.getMonth() + 1,
      };
    case 'yearly':
      return {
        ...base,
        yearlyChange: change,
        yearlyChangePercentage: changePercentage,
        yearlyMax: max,
        yearlyMin: min,
        yearlyAvg: avg,
      };
  }
}

/** 报表归档状态切换。 */
export function toggleReportArchive(report: FinancialReport, note?: string): FinancialReport {
  if (report.isArchived) {
    return { ...report, isArchived: false, archivedAt: undefined, archiveNote: undefined };
  }
  return { ...report, isArchived: true, archivedAt: new Date().toISOString(), archiveNote: note };
}

/** 报告摘要文案。 */
export function reportSummary(report: FinancialReport): string {
  const pct = report.changePercentage;
  const direction = pct >= 0 ? '增长' : '减少';
  const level = report.wealthLevelName ?? '财富等级';
  return `本期总资产 ${report.totalAmount.toFixed(2)} 元，较期初${direction} ${Math.abs(pct).toFixed(1)}%，当前为「${level}」。`;
}
