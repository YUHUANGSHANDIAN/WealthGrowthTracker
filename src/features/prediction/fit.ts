import {
  linearRegression,
  logLinearRegression,
  mae,
  rmse,
  smape,
  quantile,
  SeededRng,
} from '../../utils/math';
import { round2 } from '../../utils/money';
import type { ModelFit, TimedPoint } from './types';

/** bootstrap 迭代次数（用于情景斜率与预测区间）。 */
export const BOOTSTRAP_ITERATIONS = 300;
/** 保守情景斜率分位（p10）。 */
export const SCENARIO_LOW_Q = 0.1;
/** 积极情景斜率分位（p90）。 */
export const SCENARIO_HIGH_Q = 0.9;
/** bootstrap 默认种子（可复现）。 */
export const DEFAULT_SEED = 20261003;

/** 由一条「值函数 f(t)」构建拟合结果与诊断。 */
function buildFit(
  model: ModelFit['model'],
  points: TimedPoint[],
  valueFn: (t: number) => number,
  extra: Partial<ModelFit> = {},
): ModelFit {
  const fitted = points.map((p) => {
    const f = valueFn(p.t);
    return {
      date: p.date,
      t: p.t,
      actual: p.value,
      fitted: Number.isFinite(f) ? round2(f) : 0,
      residual: Number.isFinite(f) ? round2(p.value - f) : 0,
    };
  });
  const actual = fitted.map((f) => f.actual);
  const pred = fitted.map((f) => f.fitted);
  const last = points[points.length - 1] ?? { date: '', t: 0, value: 0 };

  return {
    model,
    suitable: true,
    fallback: false,
    n: points.length,
    spanDays: points.length ? points[points.length - 1]!.t - points[0]!.t : 0,
    mae: round2(mae(actual, pred)),
    rmse: round2(rmse(actual, pred)),
    smape: round2(smape(actual, pred)),
    fitted,
    lastValue: last.value,
    lastDate: last.date,
    ...extra,
  };
}

/** 线性模型：y = intercept + slope·t（真实 elapsed days），真正的线性外推。 */
export function fitLinear(points: TimedPoint[]): ModelFit {
  if (points.length < 2) {
    const last = points[points.length - 1];
    return {
      model: 'linear',
      suitable: false,
      notSuitableReason: '数据点不足，至少需要 2 条有效历史数据才能进行线性拟合',
      fallback: true,
      n: points.length,
      spanDays: 0,
      slope: 0,
      intercept: last?.value ?? 0,
      mae: 0,
      rmse: 0,
      smape: 0,
      fitted: [],
      lastValue: last?.value ?? 0,
      lastDate: last?.date ?? '',
    };
  }

  const reg = linearRegression(points.map((p) => ({ x: p.t, y: p.value })));
  return buildFit('linear', points, (t) => reg.intercept + reg.slope * t, {
    slope: reg.slope,
    intercept: reg.intercept,
    r2: round2(reg.r2),
  });
}

/** 指数模型：log-linear 回归 ln(y) = a + b·t，利用全部有效正数历史点。 */
export function fitExponential(points: TimedPoint[]): ModelFit {
  const positive = points.filter((p) => p.value > 0);
  const last = points[points.length - 1];

  if (positive.length < 2) {
    return {
      model: 'exponential',
      suitable: false,
      notSuitableReason: '正数数据点不足，无法拟合指数模型（金额为 0 或负数的数据不参与）',
      fallback: true,
      n: positive.length,
      spanDays: points.length ? points[points.length - 1]!.t - points[0]!.t : 0,
      mae: 0,
      rmse: 0,
      smape: 0,
      fitted: [],
      lastValue: last?.value ?? 0,
      lastDate: last?.date ?? '',
    };
  }

  const spanDays = positive[positive.length - 1]!.t - positive[0]!.t;
  if (spanDays <= 0) {
    return {
      model: 'exponential',
      suitable: false,
      notSuitableReason: '有效数据时间跨度为 0，无法拟合指数模型',
      fallback: true,
      n: positive.length,
      spanDays,
      mae: 0,
      rmse: 0,
      smape: 0,
      fitted: [],
      lastValue: last?.value ?? 0,
      lastDate: last?.date ?? '',
    };
  }

  const { a, b, r2, used } = logLinearRegression(positive.map((p) => ({ x: p.t, y: p.value })));

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {
      model: 'exponential',
      suitable: false,
      notSuitableReason: '指数模型参数溢出，当前数据不适合指数模型',
      fallback: true,
      n: used,
      spanDays,
      expA: a,
      expB: b,
      mae: 0,
      rmse: 0,
      smape: 0,
      fitted: [],
      lastValue: last?.value ?? 0,
      lastDate: last?.date ?? '',
    };
  }

  // 极端日增长率（每天翻倍级别）视为不适合，避免溢出与无意义外推
  if (Math.abs(b) > 0.7) {
    return {
      model: 'exponential',
      suitable: false,
      notSuitableReason: '数据增长/下降过于极端，指数模型外推不可靠',
      fallback: true,
      n: used,
      spanDays,
      expA: a,
      expB: b,
      mae: 0,
      rmse: 0,
      smape: 0,
      fitted: [],
      lastValue: last?.value ?? 0,
      lastDate: last?.date ?? '',
    };
  }

  const fit = buildFit('exponential', points, (t) => Math.exp(a + b * t), {
    expA: a,
    expB: b,
    r2: round2(r2),
  });
  // 指数模型的诊断指标只对「正数实际值」的点有意义（对数域内拟合）。
  const posActual = fit.fitted.filter((f) => f.actual > 0).map((f) => f.actual);
  const posPred = fit.fitted.filter((f) => f.actual > 0).map((f) => f.fitted);
  fit.mae = round2(mae(posActual, posPred));
  fit.rmse = round2(rmse(posActual, posPred));
  fit.smape = round2(smape(posActual, posPred));
  return fit;
}

/**
 * 情景模型（保守 / 积极）：
 * 以线性趋势为基础，用 residual bootstrap 估计斜率的低/高分位，
 * 形成「较低增长」与「较高增长」两条外推轨迹。
 * 保守取 p10，积极取 p90（由调用方传入 quantile 与 seed）。
 */
export function fitScenario(
  points: TimedPoint[],
  model: 'conservative' | 'aggressive',
  seed = DEFAULT_SEED,
): ModelFit {
  const central = fitLinear(points);
  if (!central.suitable || !central.slope || points.length < 2) {
    return {
      ...central,
      model,
      suitable: false,
      notSuitableReason: central.notSuitableReason ?? '数据不足，无法生成情景预测',
      fallback: true,
    };
  }

  const residuals = central.fitted.map((f) => f.residual);
  const slopes = bootstrapSlopes(points, residuals, seed);
  const q = model === 'conservative' ? SCENARIO_LOW_Q : SCENARIO_HIGH_Q;
  const slope = quantile(slopes, q);

  // 锚定在最后一个拟合值处（与中心趋势一致的起点），随时间按情景斜率发散
  const tLast = points[points.length - 1]!.t;
  const fittedLast = central.intercept! + central.slope! * tLast;
  const intercept = fittedLast - slope * tLast;

  return buildFit(model, points, (t) => intercept + slope * t, {
    slope: slope,
    intercept: intercept,
    r2: central.r2,
  });
}

/** 残差 bootstrap：重采样残差 → 重新拟合线性斜率 → 收集 bootstrap 斜率（升序）。 */
export function bootstrapSlopes(
  points: TimedPoint[],
  residuals: number[],
  seed = DEFAULT_SEED,
): number[] {
  const rng = new SeededRng(seed);
  // 以线性回归的 fitted 值作为基础，再叠加 bootstrap 残差。
  const reg = linearRegression(points.map((p) => ({ x: p.t, y: p.value })));
  const baseFitted = points.map((p) => reg.intercept + reg.slope * p.t);

  const slopes: number[] = [];
  for (let b = 0; b < BOOTSTRAP_ITERATIONS; b++) {
    const synth = points.map((p, i) => ({ x: p.t, y: baseFitted[i]! + rng.pick(residuals) }));
    const r = linearRegression(synth);
    if (Number.isFinite(r.slope)) slopes.push(r.slope);
  }
  return slopes.sort((a, b) => a - b);
}

/** 重新导出供外部使用（避免与变量名冲突）。 */
export { quantile as scenarioQuantile };
