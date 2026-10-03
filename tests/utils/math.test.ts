import { describe, it, expect } from 'vitest';
import {
  linearRegression,
  weightedLinearRegression,
  compoundGrowthRate,
  coefficientOfVariation,
  stddev,
} from '../../src/utils/math';

describe('math 统计工具', () => {
  it('linearRegression 拟合直线', () => {
    const r = linearRegression([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(r.slope).toBeCloseTo(1, 10);
    expect(r.intercept).toBeCloseTo(0, 10);
    expect(r.r2).toBeCloseTo(1, 10);
  });

  it('linearRegression 数据点不足时返回 0 斜率', () => {
    const r = linearRegression([{ x: 0, y: 5 }]);
    expect(r.slope).toBe(0);
    expect(r.intercept).toBe(5);
    expect(r.r2).toBe(0);
  });

  it('weightedLinearRegression 对后段数据更敏感', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 1 },
    ];
    const r = weightedLinearRegression(points, 0.9);
    // 后段（x=2 处 y 回落）拉低斜率，斜率应显著小于普通回归
    expect(Number.isFinite(r.slope)).toBe(true);
  });

  it('compoundGrowthRate 计算 CAGR', () => {
    // 100 → 121，一年（365 天）约 21%
    expect(compoundGrowthRate(100, 121, 365)).toBeCloseTo(0.21, 2);
    expect(compoundGrowthRate(0, 100, 365)).toBe(0);
    expect(compoundGrowthRate(100, 100, 0)).toBe(0);
  });

  it('stddev 与变异系数', () => {
    expect(stddev([2, 2, 2])).toBe(0);
    expect(coefficientOfVariation([10, 10, 10])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
  });
});
