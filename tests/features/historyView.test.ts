import { describe, expect, it } from 'vitest';
import type { Channel, HistoryPoint } from '../../src/types';
import { buildHistoryRows, historyChartPoints, historyCoverage, historyRecordTime, historySource, isHistoryDate } from '../../src/features/history/historyView';

const cash: Channel = { id: 'cash', name: '现金', emoji: '💵', amount: 100, color: '#000', isParent: true, isExpanded: false };
const point = (date: string, totalAmount: number): HistoryPoint => ({ date, totalAmount });

describe('history observation presentation', () => {
  it('distinguishes total-only observations, reconciled zero, and recorded channel composition', () => {
    expect(historyCoverage(point('2026-10-13', 0)).kind).toBe('total-only');
    expect(historyCoverage({ ...point('2026-10-13', 0), channels: [] }).kind).toBe('reconciled');
    expect(historyCoverage({ ...point('2026-10-13', 100), channels: [cash] })).toMatchObject({ kind: 'reconciled', label: '构成一致' });
  });

  it('flags stale parent rollups, unmatched totals, and invalid or duplicated channel IDs', () => {
    const parent = { ...cash, children: [{ id: 'child', parentId: 'cash', name: '子账户', emoji: '💳', amount: 50, color: '#000' }] };
    expect(historyCoverage({ ...point('2026-10-13', 50), channels: [parent] }).kind).toBe('inconsistent');
    expect(historyCoverage({ ...point('2026-10-13', 101), channels: [cash] }).kind).toBe('inconsistent');
    expect(historyCoverage({ ...point('2026-10-13', 200), channels: [cash, cash] }).kind).toBe('inconsistent');
    expect(historyCoverage({ ...point('2026-10-13', 100), channels: [{ ...cash, amount: Number.NaN }] }).kind).toBe('inconsistent');
  });

  it('does not turn invalid totals into zero or admit them as comparison baselines', () => {
    const rows = buildHistoryRows([point('2026-10-11', 100), point('2026-10-12', Number.NaN), point('2026-10-13', 0)], '2026-10-13');
    expect(rows[1]?.coverage.kind).toBe('invalid');
    expect(rows[1]?.difference).toBeNull();
    expect(rows[2]).toMatchObject({ previousDate: '2026-10-11', difference: -100 });
    expect(historyCoverage(point('2026-10-13', -1)).kind).toBe('invalid');
  });

  it('computes differences before filtering and handles a valid zero baseline', () => {
    const history = [point('2026-10-13', 0.3), point('2026-10-11', 0), point('2026-10-12', 0.1)];
    const rows = buildHistoryRows(history, '2026-10-13');
    expect(rows.filter(row => row.point.date === '2026-10-13')[0]).toMatchObject({ previousDate: '2026-10-12', difference: 0.2 });
    expect(rows[1]?.difference).toBe(0.1);
    expect(history[0]?.date).toBe('2026-10-13');
  });

  it('marks future and impossible dates and excludes them from the observed trend', () => {
    const rows = buildHistoryRows([point('2026-10-13', 100), point('2026-10-14', 200), point('2026-02-30', 300)], '2026-10-13');
    expect(rows.find(row => row.point.date === '2026-10-14')).toMatchObject({ future: true, difference: null });
    expect(rows.find(row => row.point.date === '2026-02-30')?.validDate).toBe(false);
    expect(historyChartPoints(rows)).toEqual([{ date: '2026-10-13', value: 100 }]);
    expect(isHistoryDate('2024-02-29')).toBe(true);
    expect(isHistoryDate('2026-02-29')).toBe(false);
  });

  it('preserves missing-day breaks and invalid amount gaps without expanding a long interval', () => {
    const rows = buildHistoryRows([point('2026-01-01', 100), point('2026-10-12', Number.NaN), point('2026-10-13', 120)], '2026-10-13');
    expect(historyChartPoints(rows)).toEqual([
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: null },
      { date: '2026-10-12', value: null },
      { date: '2026-10-13', value: 120 },
    ]);
  });

  it('gives unknown sources explicit fallbacks and prefers original record time to update time', () => {
    expect(historySource().label).toBe('来源未记录');
    expect(historySource('future-provider' as HistoryPoint['source']).label).toBe('其他来源');
    const recorded = Date.parse('2026-10-10T08:30:00.000Z');
    expect(historyRecordTime({ ...point('2026-10-13', 1), timestamp: recorded, updatedAt: '2026-10-13T02:00:00.000Z' })).toMatchObject({ label: '记录时间', iso: '2026-10-10T08:30:00.000Z' });
    expect(historyRecordTime({ ...point('2026-10-13', 1), updatedAt: '2026-10-13T02:00:00.000Z' })).toMatchObject({ label: '更新时间' });
    expect(historyRecordTime({ ...point('2026-10-13', 1), timestamp: Number.NaN, updatedAt: 'invalid' })).toBeNull();
  });
});
