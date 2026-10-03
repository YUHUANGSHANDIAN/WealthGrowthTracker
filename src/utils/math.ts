import type { HistoryPoint } from '../types';

/**
 * 统计/预测所需的纯数学函数。全部无副作用、可单测。
 * 与旧版逻辑对齐：线性预测用「加权线性回归」，指数预测用「复合增长率(CAGR)」，
 * 保守/激进在基础增长率上做风险调节。
 */

/** 简单线性回归：返回 {slope, intercept, r2}。 */
export function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };

  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // R²
  const meanY = sy / n;
  const ssTot = syy - n * meanY * meanY;
  const ssRes =
    syy - 2 * intercept * sy - 2 * slope * sxy + n * intercept * intercept + 2 * slope * intercept * sx + slope * slope * sxx;
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return { slope, intercept, r2 };
}

/** 加权线性回归：越靠后的数据点权重越大（weight^i）。 */
export function weightedLinearRegression(
  points: { x: number; y: number }[],
  weightBase = 0.9,
): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };

  // 权重：索引 i 的点权重为 weightBase^(n-1-i)
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxy = 0;
  let swxx = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const w = Math.pow(weightBase, n - 1 - i);
    sw += w;
    swx += w * p.x;
    swy += w * p.y;
    swxy += w * p.x * p.y;
    swxx += w * p.x * p.x;
  }
  const denom = sw * swxx - swx * swx;
  const slope = denom === 0 ? 0 : (sw * swxy - swx * swy) / denom;
  const intercept = (swy - slope * swx) / sw;
  return { slope, intercept };
}

/** 复合年化增长率（CAGR），基于首尾两个点的天数。 */
export function compoundGrowthRate(
  first: number,
  last: number,
  daysElapsed: number,
): number {
  if (daysElapsed <= 0 || first <= 0 || last <= 0) return 0;
  const ratio = last / first;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.pow(ratio, 365 / daysElapsed) - 1;
}

/** 历史点的逐段增长率（相邻点）。 */
export function periodGrowthRates(history: HistoryPoint[]): number[] {
  const rates: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!.totalAmount;
    const curr = history[i]!.totalAmount;
    if (prev > 0 && curr > 0) {
      const days = Math.max(1, daysBetweenDates(history[i - 1]!.date, history[i]!.date));
      const total = curr / prev - 1;
      rates.push(total / days); // 日均增长率
    }
  }
  return rates;
}

function daysBetweenDates(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** 标准差。 */
export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** 变异系数 = 标准差 / 均值（去量纲，衡量波动）。 */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  return stddev(values) / Math.abs(mean);
}

/** 把 [0,1] 的波动值 clamp 到区间。 */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
