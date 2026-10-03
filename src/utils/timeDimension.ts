import type { HistoryPoint } from '../types';
import { monthStart, weekStart, yearStart, parseDateString } from './date';

export type TimeDimension = 'raw' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * 按时间维度聚合历史数据为「期末值」。
 * 资产数据是 point-in-time balance，聚合取每段最后有效值（而非求和）。
 */
export function aggregateHistory(history: HistoryPoint[], dimension: TimeDimension): HistoryPoint[] {
  if (dimension === 'raw') return [...history].sort((a, b) => (a.date < b.date ? -1 : 1));

  const bucket = (date: string): string => {
    const d = parseDateString(date);
    switch (dimension) {
      case 'daily':
        return date;
      case 'weekly':
        return weekStart(date);
      case 'monthly':
        return monthStart(date);
      case 'quarterly':
        return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
      case 'yearly':
        return yearStart(date);
      default:
        return date;
    }
  };

  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const map = new Map<string, HistoryPoint>();
  for (const h of sorted) map.set(bucket(h.date), h);
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 按显示范围过滤历史数据。 */
export function filterHistoryRange(history: HistoryPoint[], range: string, customStart?: string, customEnd?: string): HistoryPoint[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (range === 'all' || range === 'ytd') {
    if (range === 'ytd') {
      const start = yearStart(new Date().toISOString().slice(0, 10));
      return sorted.filter((h) => h.date >= start);
    }
    return sorted;
  }
  const days = Number(range);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sorted.filter((h) => h.date >= cutoffStr);
  }
  if (range === 'custom' && (customStart || customEnd)) {
    return sorted.filter((h) => (!customStart || h.date >= customStart) && (!customEnd || h.date <= customEnd));
  }
  return sorted;
}

/** 按训练窗口（最近 N 天）过滤历史数据（用于模型训练）。 */
export function filterTrainingWindow(history: HistoryPoint[], window: string, customDays?: number): HistoryPoint[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (window === 'all') return sorted;
  const days = window === 'custom' ? customDays ?? 365 : Number(window);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sorted.filter((h) => h.date >= cutoffStr);
  }
  return sorted;
}
