import type { HistoryPoint } from '../../types';
import { daysBetween } from '../../utils/date';
import type { DataQualityReport, TimedPoint } from './types';

/**
 * 时间序列预处理：
 * - 过滤非法记录（无日期 / 金额非有限数）
 * - 按日期升序排序
 * - 同一天多条记录时保留最后一条（不虚构数据）
 * - 计算真实 elapsed days（t = 距首个有效日期的天数）作为统一时间轴
 */
export function prepareSeries(history: HistoryPoint[]): {
  points: TimedPoint[];
  quality: DataQualityReport;
} {
  const valid = history.filter((h) => h && typeof h.date === 'string' && h.date && Number.isFinite(h.totalAmount));

  const sorted = [...valid].sort((a, b) => (a.date < b.date ? -1 : 1));

  // 去重：同一天保留最后一条
  const byDate = new Map<string, HistoryPoint>();
  let hadDuplicates = false;
  for (const h of sorted) {
    if (byDate.has(h.date)) hadDuplicates = true;
    byDate.set(h.date, h);
  }
  const entries = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const firstDate = entries[0]?.[0] ?? '';
  const lastDate = entries[entries.length - 1]?.[0] ?? '';

  const points: TimedPoint[] = entries.map(([date, h]) => ({
    date,
    t: firstDate ? daysBetween(firstDate, date) : 0,
    value: h.totalAmount,
  }));

  const positiveCount = points.filter((p) => p.value > 0).length;
  const spanDays = points.length ? points[points.length - 1]!.t - points[0]!.t : 0;
  const avgIntervalDays = points.length > 1 ? spanDays / (points.length - 1) : 0;

  let maxGapDays = 0;
  for (let i = 1; i < points.length; i++) {
    maxGapDays = Math.max(maxGapDays, points[i]!.t - points[i - 1]!.t);
  }

  // 异常跳变：相邻点日变化超过 ±50% 视为疑似（仅提示，不删除）
  const anomalies: DataQualityReport['anomalies'] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.value > 0 && curr.value > 0) {
      const jumpRatio = curr.value / prev.value;
      if (jumpRatio >= 1.5 || jumpRatio <= 1 / 1.5) {
        anomalies.push({ date: curr.date, value: curr.value, prevValue: prev.value, jumpRatio });
      }
    }
  }

  return {
    points,
    quality: {
      rawCount: history.length,
      pointCount: points.length,
      positiveCount,
      firstDate,
      lastDate,
      spanDays,
      avgIntervalDays: Math.round(avgIntervalDays * 10) / 10,
      maxGapDays,
      anomalies: anomalies.slice(-10),
      hadDuplicates,
    },
  };
}
