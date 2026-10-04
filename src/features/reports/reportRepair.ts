import type { FinancialReport, HistoryPoint, ReportFieldProvenance } from '../../types';
import { round2 } from '../../utils/money';
import { buildChannelDetails, topChannelsFrom } from './normalize';
import { latestPointAtOrBefore } from './generate';

/**
 * Report Repair（v1.4）：历史报告缺失字段用真实 HistoryPoint 恢复，
 * 与「普通 Edit」区分开——普通 Edit 只能改标题/备注/标签/摘要，历史事实走这里。
 * 所有修复均为纯函数、确定性、幂等，并记录 fieldProvenance / repairAudit。
 */

/** 报告展示标题：customTitle ?? standardTitle ?? title。 */
export function displayTitle(report: FinancialReport): string {
  if (report.titleMode === 'custom' && report.customTitle?.trim()) return report.customTitle;
  return report.standardTitle ?? report.title;
}

/** 同 periodKey 的冲突报告（未归档则可能被 update 覆盖）。 */
export function findReportConflict(reports: FinancialReport[], periodKey: string | undefined): FinancialReport | undefined {
  if (!periodKey) return undefined;
  return reports.find((r) => r.periodKey === periodKey);
}

/** 期间极值字段名（按类型）。 */
function extremaKeys(report: FinancialReport): { max: string; min: string; avg: string } {
  switch (report.reportType) {
    case 'weekly':
      return { max: 'weeklyMax', min: 'weeklyMin', avg: 'weeklyAvg' };
    case 'monthly':
      return { max: 'monthlyMax', min: 'monthlyMin', avg: 'monthlyAvg' };
    case 'yearly':
      return { max: 'yearlyMax', min: 'yearlyMin', avg: 'yearlyAvg' };
  }
}

export interface RepairResult {
  report: FinancialReport;
  repairedFields: string[];
  /** 无法恢复的字段说明（诚实提示）。 */
  warnings: string[];
}

/**
 * 用真实历史数据安全恢复报告缺失字段：
 * - previousTotalAmount ← 期间开始前最近一次 HistoryPoint
 * - 期间 max/min/avg ← startDate~endDate 的真实 HistoryPoint
 * - historyPointsCount ← 期间真实点数量
 * - channelDetails/topChannels ← endDate 当天或之前最近的 channels 快照
 * 绝不使用「今天的 channels」，也不编造缺失数据。
 */
export function repairReportFromHistory(report: FinancialReport, history: HistoryPoint[]): RepairResult {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const inPeriod = sorted.filter((p) => p.date >= report.startDate && p.date <= report.endDate);

  const next: FinancialReport = { ...report };
  const provenance: NonNullable<FinancialReport['fieldProvenance']> = { ...(report.fieldProvenance ?? {}) };
  const audit: NonNullable<FinancialReport['repairAudit']> = [...(report.repairAudit ?? [])];
  const repairedFields: string[] = [];
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const mark = (field: string, source: ReportFieldProvenance) => {
    provenance[field] = source;
    if (!repairedFields.includes(field)) repairedFields.push(field);
  };
  const record = (field: string, oldValue: unknown, newValue: unknown, source: ReportFieldProvenance, reason: string) => {
    audit.push({ field, oldValue, newValue, reason, source, repairedAt: now });
    mark(field, source);
  };

  // previousTotalAmount（与 generate 一致：取 startDate 当日或之前最近一次历史点）
  if (report.previousTotalAmount === undefined) {
    const prev = latestPointAtOrBefore(history, report.startDate);
    if (prev) {
      record('previousTotalAmount', undefined, prev.totalAmount, 'history-snapshot', '从期间开始前最近一次历史点恢复');
      next.previousTotalAmount = prev.totalAmount;
    } else {
      warnings.push('缺少期初资产（历史中无期间之前的数据点）');
    }
  }

  // 期间极值 / 均值 / 计数
  if (inPeriod.length > 0) {
    const amounts = inPeriod.map((p) => p.totalAmount);
    const keys = extremaKeys(report);
    if ((next as unknown as Record<string, unknown>)[keys.max] === undefined) {
      const v = Math.max(...amounts);
      record(keys.max, undefined, v, 'history-snapshot', '从期间真实历史点恢复最高值');
      (next as unknown as Record<string, unknown>)[keys.max] = v;
    }
    if ((next as unknown as Record<string, unknown>)[keys.min] === undefined) {
      const v = Math.min(...amounts);
      record(keys.min, undefined, v, 'history-snapshot', '从期间真实历史点恢复最低值');
      (next as unknown as Record<string, unknown>)[keys.min] = v;
    }
    if ((next as unknown as Record<string, unknown>)[keys.avg] === undefined) {
      const v = round2(amounts.reduce((a, b) => a + b, 0) / amounts.length);
      record(keys.avg, undefined, v, 'history-snapshot', '从期间真实历史点恢复平均值');
      (next as unknown as Record<string, unknown>)[keys.avg] = v;
    }
    if (report.historyPointsCount === undefined) {
      record('historyPointsCount', undefined, inPeriod.length, 'history-snapshot', '重新计算期间历史点数');
      next.historyPointsCount = inPeriod.length;
    }
  } else {
    warnings.push('期间无历史数据点，无法恢复极值/均值');
  }

  // 渠道构成（从 endDate 当天或之前最近的 channels 快照恢复）
  if ((!report.channelDetails || report.channelDetails.length === 0) && !report.channels?.length) {
    const endSnapshot = [...sorted].reverse().find((p) => p.channels && p.channels.length > 0 && p.date <= report.endDate);
    if (endSnapshot?.channels) {
      const details = buildChannelDetails(endSnapshot.channels, report.totalAmount);
      next.channels = endSnapshot.channels;
      next.channelDetails = details;
      next.channelSnapshotMissing = false;
      next.topChannels = topChannelsFrom(details);
      record('channelDetails', undefined, 'history-snapshot', 'history-snapshot', `从 ${endSnapshot.date} 的历史渠道快照恢复渠道构成`);
      record('topChannels', undefined, 'history-snapshot', 'history-snapshot', '从恢复的渠道构成推导 TOP 渠道');
    } else {
      next.channelSnapshotMissing = true;
      warnings.push('该版本历史记录未保存渠道构成，无法恢复（不推算、不使用今天的数据）');
    }
  }

  next.fieldProvenance = provenance;
  if (audit.length > 0) next.repairAudit = audit;

  return { report: next, repairedFields, warnings };
}
