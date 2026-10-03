import { describe, it, expect } from 'vitest';
import type { HistoryPoint } from '../../src/types';
import {
  computeStats,
  predictSeries,
  predictWithModel,
  predictHybrid,
  recommendModel,
  analyzeDimensions,
} from '../../src/features/prediction/models';

const history: HistoryPoint[] = [
  { date: '2026-01-01', totalAmount: 100 },
  { date: '2026-02-01', totalAmount: 120 },
  { date: '2026-03-01', totalAmount: 150 },
  { date: '2026-04-01', totalAmount: 200 },
];

describe('预测模型（纯本地规则）', () => {
  it('computeStats 输出合法范围', () => {
    const s = computeStats(history);
    expect(s.volatility).toBeGreaterThanOrEqual(0);
    expect(s.volatility).toBeLessThanOrEqual(1);
    expect(s.trend).toBe('increasing');
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
  });

  it('predictSeries 从最后一点开始、逐日复利、终点被包含', () => {
    const points = predictSeries(history, 0.001, 90, 'linear', 7);
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]!.date > history[3]!.date).toBe(true);
    expect(points[points.length - 1]!.totalAmount).toBeGreaterThan(history[3]!.totalAmount);
    expect(points.every((p) => p.isPrediction)).toBe(true);
  });

  it('predictWithModel 各模型不崩溃且单调递增（正增长率）', () => {
    for (const m of ['linear', 'exponential', 'conservative', 'aggressive'] as const) {
      const points = predictWithModel(history, m, 180);
      expect(points.length).toBeGreaterThan(0);
      // 正增长历史下，预测终点应大于起点
      expect(points[points.length - 1]!.totalAmount).toBeGreaterThanOrEqual(history[3]!.totalAmount);
    }
  });

  it('predictHybrid 返回按日期排序的预测', () => {
    const points = predictHybrid(history, 90);
    expect(points.length).toBeGreaterThan(0);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.date >= points[i - 1]!.date).toBe(true);
    }
  });

  it('recommendModel 数据充足且趋势向上时给出合理建议', () => {
    const rec = recommendModel(history, 0.2);
    expect(['linear', 'exponential', 'conservative', 'aggressive']).toContain(rec.model);
    expect(rec.reasons.length).toBeGreaterThan(0);
    expect(rec.advice.length).toBeGreaterThan(0);
  });

  it('recommendModel 数据不足时回退线性', () => {
    const rec = recommendModel([{ date: '2026-01-01', totalAmount: 100 }], 0.5);
    expect(rec.model).toBe('linear');
  });

  it('analyzeDimensions 返回 3 个 0-100 维度', () => {
    const dims = analyzeDimensions(history);
    expect(dims).toHaveLength(3);
    for (const d of dims) {
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThanOrEqual(100);
    }
  });
});
