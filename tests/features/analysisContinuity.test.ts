import { describe, expect, it } from 'vitest';
import { historyTrend, smoothTrend } from '../../src/features/analysis/trend';
import { historicalChannelComposition } from '../../src/features/analysis/analytics';
import type { Channel } from '../../src/types';

const channel = (id: string, amount: number, name = '同名渠道'): Channel => ({ id, amount, name, emoji: '🌱', color: '#123456', isParent: true, isExpanded: false });

describe('analysis continuity and identity', () => {
  it('daily gaps break curves and smoothing restarts after the gap', () => {
    const points = historyTrend([{ date: '2026-01-01', totalAmount: 10 }, { date: '2026-01-04', totalAmount: 100 }], 'daily');
    expect(points).toEqual([{ date: '2026-01-01', value: 10 }, { date: '2026-01-02', value: null }, { date: '2026-01-04', value: 100 }]);
    expect(smoothTrend(points)).toEqual(points);
  });
  it('adjacent calendar months connect but missing months do not', () => {
    const points = historyTrend([{ date: '2024-01-31', totalAmount: 10 }, { date: '2024-02-29', totalAmount: 20 }, { date: '2024-04-30', totalAmount: 30 }], 'monthly');
    expect(points.filter(p => p.value === null)).toEqual([{ date: '2024-03-01', value: null }]);
  });
  it('interval Top N keeps identity through rank changes and renames', () => {
    const result = historicalChannelComposition([
      { date: '2026-01-01', totalAmount: 110, channels: [channel('a', 100), channel('b', 10)] },
      { date: '2026-01-02', totalAmount: 120, channels: [channel('a', 40, '新名字'), channel('b', 80)] },
    ], { level: 'parent', topN: 1, mode: 'absolute' });
    expect(result.map(p => p.channels[0]?.id)).toEqual(['parent:a', 'parent:a']);
    expect(result.map(p => p.channels[0]?.amount)).toEqual([100, 40]);
    expect(result[0]?.channels[0]?.name).toBe('新名字');
  });
  it('same names remain separate and signed unallocated difference conserves the recorded total', () => {
    const result = historicalChannelComposition([{ date: '2026-01-01', totalAmount: 100, channels: [channel('a', 100), channel('b', 50)] }], { level: 'parent', topN: 5, mode: 'absolute' });
    const items = result[0]!.channels;
    expect(new Set(items.map(item => item.name)).size).toBe(3);
    expect(items.find(item => item.id === 'aggregate:unallocated')?.amount).toBe(-50);
    expect(items.reduce((sum, item) => sum + item.amount, 0)).toBe(100);
  });
});
