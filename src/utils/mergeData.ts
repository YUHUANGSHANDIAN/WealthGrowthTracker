import type { Channel, FinancialReport, HistoryPoint } from '../types';

export interface MergePreview {
  channels: { added: number; updated: number; conflict: number };
  history: { added: number; conflict: number };
  reports: { added: number };
}

/** 合并预览：统计导入数据相对当前数据的差异。 */
export function previewMerge(
  current: { channels: Channel[]; history: HistoryPoint[]; reports: FinancialReport[] },
  incoming: { channels: Channel[]; history: HistoryPoint[]; reports: FinancialReport[] },
): MergePreview {
  const curIds = new Set(current.channels.map((c) => c.id));
  const channelsAdded = incoming.channels.filter((c) => !curIds.has(c.id)).length;
  const channelsConflict = incoming.channels.filter((c) => curIds.has(c.id)).length;

  const curDates = new Set(current.history.map((h) => h.date));
  const historyAdded = incoming.history.filter((h) => !curDates.has(h.date)).length;
  const historyConflict = incoming.history.filter((h) => curDates.has(h.date)).length;

  const curReportIds = new Set(current.reports.map((r) => r.id));
  const reportsAdded = incoming.reports.filter((r) => !curReportIds.has(r.id)).length;

  return {
    channels: { added: channelsAdded, updated: 0, conflict: channelsConflict },
    history: { added: historyAdded, conflict: historyConflict },
    reports: { added: reportsAdded },
  };
}

/**
 * 合并策略（ID/日期优先）：
 * - 渠道：ID 优先，冲突保留当前（不覆盖）。
 * - 历史：date 优先，冲突保留当前。
 * - 报告：ID 优先，冲突跳过。
 */
export function mergeData(
  current: { channels: Channel[]; history: HistoryPoint[]; reports: FinancialReport[] },
  incoming: { channels: Channel[]; history: HistoryPoint[]; reports: FinancialReport[] },
): { channels: Channel[]; history: HistoryPoint[]; reports: FinancialReport[] } {
  const channels = [...current.channels];
  const curIds = new Set(channels.map((c) => c.id));
  for (const c of incoming.channels) if (!curIds.has(c.id)) channels.push(c);

  const history = [...current.history];
  const curDates = new Set(history.map((h) => h.date));
  for (const h of incoming.history) if (!curDates.has(h.date)) history.push(h);
  history.sort((a, b) => (a.date < b.date ? -1 : 1));

  const reports = [...current.reports];
  const curReportIds = new Set(reports.map((r) => r.id));
  for (const r of incoming.reports) if (!curReportIds.has(r.id)) reports.push(r);

  return { channels, history, reports };
}
