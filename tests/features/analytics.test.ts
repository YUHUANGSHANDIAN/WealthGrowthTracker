import { describe, it, expect } from 'vitest';
import type { Channel, HistoryPoint } from '../../src/types';
import { analyticsKpis, assetConcentration, periodComparison, channelChange, historicalChannelComposition } from '../../src/features/analysis/analytics';

const channels: Channel[] = [
  { id: 'a', name: '支付宝', emoji: '💙', amount: 0, color: '#3B82F6', isParent: true, isExpanded: false, children: [{ id: 'a1', name: '余额', emoji: '💰', amount: 800, color: '#10B981', parentId: 'a' }] },
  { id: 'b', name: '现金', emoji: '💵', amount: 200, color: '#000', isParent: true, isExpanded: false, children: [] },
];

const history: HistoryPoint[] = [
  { date: '2026-01-01', totalAmount: 500 },
  { date: '2026-06-01', totalAmount: 800 },
  { date: '2026-09-30', totalAmount: 1000 },
];

describe('分析系统', () => {
  it('KPI 计算（起点/变化/极值/覆盖率）', () => {
    const k = analyticsKpis(history, channels, '2026-01-01');
    expect(k.currentTotal).toBe(1000); // 800 + 200
    expect(k.startTotal).toBe(500);
    expect(k.change).toBe(500);
    expect(k.max).toBe(1000);
    expect(k.min).toBe(500);
    expect(k.pointCount).toBe(3);
  });

  it('资产集中度（TOP1/TOP3/HHI）', () => {
    const c = assetConcentration(channels);
    expect(c.top1).toBe(80);
    expect(c.top3).toBe(100);
    expect(c.hhi).toBeGreaterThan(0);
  });

  it('集中度：无资产时返回 0', () => {
    expect(assetConcentration([])).toEqual({ top1: 0, top3: 0, hhi: 0 });
  });

  it('渠道变化：过去为 0 时 changeRate 为 null', () => {
    const ch = channelChange(history, channels, 30);
    expect(ch.length).toBe(2);
  });

  it('历史渠道构成：跳过无快照的点', () => {
    const snapHistory: HistoryPoint[] = [
      { date: '2026-01-01', totalAmount: 500 },
      { date: '2026-02-01', totalAmount: 800, channels },
    ];
    const comp = historicalChannelComposition(snapHistory, { level: 'leaf', topN: 5, mode: 'absolute' });
    expect(comp).toHaveLength(2); // 包含缺快照的点（missing）
    expect(comp[1]!.channels.length).toBe(2);
    expect(comp[0]!.missing).toBe(true);
  });

  it('periodComparison 返回 WoW/MoM/YoY 或 null', () => {
    const pc = periodComparison(history);
    expect(pc).toHaveProperty('wow');
    expect(pc).toHaveProperty('mom');
    expect(pc).toHaveProperty('yoy');
  });
});
