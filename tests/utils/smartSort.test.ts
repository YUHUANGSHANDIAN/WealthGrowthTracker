import { describe, it, expect } from 'vitest';
import { computeChannelGrowths, computeSmartScore, sortChannelsSmart } from '../../src/utils/smartSort';
import type { Channel, HistoryPoint } from '../../src/types';

const channels: Channel[] = [
  { id: 'a', name: 'A', emoji: '💰', amount: 100, color: '#000', isParent: true, isExpanded: false, children: [] },
  { id: 'b', name: 'B', emoji: '💰', amount: 0, color: '#000', isParent: true, isExpanded: false, children: [{ id: 'b1', name: 'B1', emoji: '💰', amount: 50, color: '#000', parentId: 'b' }] },
];

describe('渠道增长与智能排序', () => {
  it('computeChannelGrowths 基于历史快照计算增长', () => {
    const history: HistoryPoint[] = [
      {
        date: '2026-01-01',
        totalAmount: 100,
        channels: [
          { id: 'a', name: 'A', emoji: '💰', amount: 80, color: '#000', isParent: true, isExpanded: false, children: [] },
          { id: 'b', name: 'B', emoji: '💰', amount: 0, color: '#000', isParent: true, isExpanded: false, children: [{ id: 'b1', name: 'B1', emoji: '💰', amount: 20, color: '#000', parentId: 'b' }] },
        ],
      },
    ];
    const growths = computeChannelGrowths(history, channels);
    // a: 80 → 100 (+25%)，b1: 20 → 50 (+150%)
    expect(growths.get('a')!.g30d).toBeCloseTo(0.25, 5);
    expect(growths.get('b1')!.g30d).toBeCloseTo(1.5, 5);
  });

  it('无历史快照时增长为 null（不是 0）', () => {
    const growths = computeChannelGrowths([{ date: '2026-01-01', totalAmount: 100 }], channels);
    expect(growths.get('a')!.g30d).toBeNull();
    expect(growths.get('b1')!.g30d).toBeNull();
  });

  it('computeSmartScore 权重归一化且分数在 0-100', () => {
    const growths = new Map();
    const score = computeSmartScore(channels[0]!, growths, 100);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.amountShare).toBeCloseTo(100, 5); // a 占 100/100
  });

  it('sortChannelsSmart 固定渠道置顶', () => {
    const growths = new Map();
    const order = sortChannelsSmart(channels, growths, 150, new Set(['b']));
    expect(order[0]!.id).toBe('b'); // b 固定置顶
  });
});
