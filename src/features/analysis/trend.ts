import type { HistoryPoint } from '../../types';
import { aggregateHistory, type TimeDimension } from '../../utils/timeDimension';
import { addDays } from '../../utils/date';

export interface TrendPoint { date: string; value: number | null }

function bucket(date: string, dimension: TimeDimension): number {
  const time = Date.parse(date);
  const parsed = new Date(time);
  const month = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  switch (dimension) {
    case 'weekly': return Math.floor((time / 86_400_000 + 3) / 7);
    case 'monthly': return month;
    case 'quarterly': return Math.floor(month / 3);
    case 'yearly': return parsed.getUTCFullYear();
    default: return Math.floor(time / 86_400_000);
  }
}

/** One null marker per missing run preserves gaps without expanding decades into daily rows. */
export function historyTrend(history: HistoryPoint[], dimension: TimeDimension): TrendPoint[] {
  const points = aggregateHistory(history, dimension);
  const result: TrendPoint[] = [];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous && bucket(point.date, dimension) - bucket(previous.date, dimension) > 1) {
      result.push({ date: addDays(previous.date, 1), value: null });
    }
    result.push({ date: point.date, value: Number.isFinite(point.totalAmount) ? point.totalAmount : null });
  }
  return result;
}

export function smoothTrend(points: TrendPoint[], window = 3): TrendPoint[] {
  let values: number[] = [];
  return points.map(point => {
    if (point.value === null) { values = []; return point; }
    values.push(point.value);
    values = values.slice(-Math.max(1, window));
    return { ...point, value: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 };
  });
}
