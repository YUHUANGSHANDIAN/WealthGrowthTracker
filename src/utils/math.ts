/**
 * 统计 / 预测所需的纯数学函数。全部无副作用、可单测。
 *
 * 约定：
 * - 时间轴统一使用「真实 elapsed days」作为自变量 X（见 prediction/series.ts），
 *   绝不用「第几条」这类伪索引。
 * - 误差指标 MAE / RMSE / sMAPE 用于模型诊断与回测，不用于伪称「统计置信度」。
 */

export interface Point {
  x: number;
  y: number;
}

/** 简单线性回归 y = slope·x + intercept，返回 slope、intercept、R²。 */
export function linearRegression(points: Point[]): {
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

/** 加权线性回归：越靠后的数据点权重越大（weightBase^(n-1-i)，weightBase∈(0,1]）。 */
export function weightedLinearRegression(
  points: Point[],
  weightBase = 0.9,
): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };

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

/**
 * log-linear 回归：ln(y) = a + b·x，用于指数增长模型的拟合。
 * 仅使用 y > 0 的点（金额为 0 或负数不参与对数拟合）。
 */
export function logLinearRegression(points: Point[]): { a: number; b: number; r2: number; used: number } {
  const valid = points.filter((p) => p.y > 0 && Number.isFinite(Math.log(p.y)));
  if (valid.length < 2) {
    return { a: 0, b: 0, r2: 0, used: valid.length };
  }
  const { slope: b, intercept: a, r2 } = linearRegression(
    valid.map((p) => ({ x: p.x, y: Math.log(p.y) })),
  );
  return { a, b, r2, used: valid.length };
}

// ---------------------------------------------------------------------------
// 误差指标
// ---------------------------------------------------------------------------

/** 平均绝对误差。 */
export function mae(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(actual[i]! - predicted[i]!);
  return sum / n;
}

/** 均方根误差。 */
export function rmse(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = actual[i]! - predicted[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

/**
 * 对称平均绝对百分比误差（0~200，百分比）。
 * 相比普通 MAPE 对接近 0 的值更稳健。
 */
export function smape(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(actual[i]!);
    const p = Math.abs(predicted[i]!);
    const denom = a + p;
    if (denom === 0) continue; // 双方都为 0，视为完美预测
    sum += (2 * Math.abs(actual[i]! - predicted[i]!)) / denom;
  }
  return (sum / n) * 100;
}

// ---------------------------------------------------------------------------
// 统计量
// ---------------------------------------------------------------------------

/** 均值。 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 标准差（总体标准差，除以 n）。 */
export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length;
  return Math.sqrt(variance);
}

/** 变异系数 = 标准差 / |均值|（去量纲，衡量波动）。 */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  return stddev(values) / Math.abs(m);
}

/**
 * 分位数（对已升序排序的数组，线性插值，R-7 型）。
 * q ∈ [0,1]。
 */
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = pos - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

/** 复合年化增长率（CAGR），基于首尾两点的天数。仅供展示，不再作为指数模型主算法。 */
export function compoundGrowthRate(first: number, last: number, daysElapsed: number): number {
  if (daysElapsed <= 0 || first <= 0 || last <= 0) return 0;
  const ratio = last / first;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.pow(ratio, 365 / daysElapsed) - 1;
}

/** 把值 clamp 到 [0,1]。 */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// 可复现伪随机数（用于 bootstrap，固定 seed 使单元测试可重复）
// ---------------------------------------------------------------------------

/** mulberry32 可复现 PRNG。 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 [0,1) 的浮点数。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, maxExclusive) 的整数。 */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** 从数组中随机取一个元素。 */
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)]!;
  }
}

/** 归一化一组权重，使其总和为 1（全为 0 时均分）。 */
export function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return weights.map(() => 1 / weights.length);
  return weights.map((w) => Math.max(0, w) / total);
}
