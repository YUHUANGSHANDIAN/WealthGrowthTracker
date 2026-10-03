import { addDays } from '../../utils/date';
import { round2 } from '../../utils/money';
import { mean, quantile, SeededRng } from '../../utils/math';
import type { Forecast, ForecastPoint, GoalReachEstimate, ModelFit, TimedPoint } from './types';
import { BOOTSTRAP_ITERATIONS, DEFAULT_SEED } from './fit';

/** 正态近似 95% 分位。 */
const Z95 = 1.96;

/** 根据预测跨度选择合适的采样间隔，控制 SVG 点数（约 20~28 个预测点）。 */
export function niceInterval(horizonDays: number): number {
  const steps = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365];
  const target = Math.max(1, horizonDays / 28);
  for (const s of steps) if (s >= target) return s;
  return steps[steps.length - 1]!;
}

/** 生成未来采样点（date + elapsed t），始终包含终点。 */
export function futureGrid(lastDate: string, lastT: number, horizonDays: number): { date: string; t: number }[] {
  if (horizonDays <= 0) return [];
  const interval = niceInterval(horizonDays);
  const grid: { date: string; t: number }[] = [];
  for (let d = interval; d < horizonDays; d += interval) {
    grid.push({ date: addDays(lastDate, d), t: lastT + d });
  }
  grid.push({ date: addDays(lastDate, horizonDays), t: lastT + horizonDays });
  return grid;
}

/** 中心预测：由值函数 f(t) 生成未来点（不含区间）。 */
function centralForecast(grid: { date: string; t: number }[], f: (t: number) => number): ForecastPoint[] {
  return grid.map((g) => {
    const v = f(g.t);
    return { date: g.date, t: g.t, value: Number.isFinite(v) ? round2(v) : 0, isForecast: true };
  });
}

/**
 * 线性模型 95% 预测区间（标准回归公式）：
 * ŷ ± z·s·sqrt(1 + 1/n + (t - t̄)²/Sxx)
 */
function analyticLinearInterval(
  points: TimedPoint[],
  fit: ModelFit,
  grid: { date: string; t: number }[],
): Map<number, { lower: number; upper: number }> {
  const n = points.length;
  if (n < 3 || fit.slope === undefined || fit.intercept === undefined) return new Map();
  const residuals = fit.fitted.map((f) => f.residual);
  const ssr = residuals.reduce((a, r) => a + r * r, 0);
  const s = Math.sqrt(ssr / (n - 2));
  const tMean = mean(points.map((p) => p.t));
  const sxx = points.reduce((a, p) => a + (p.t - tMean) * (p.t - tMean), 0);
  if (sxx <= 0) return new Map();

  const map = new Map<number, { lower: number; upper: number }>();
  for (const g of grid) {
    const se = s * Math.sqrt(1 + 1 / n + ((g.t - tMean) * (g.t - tMean)) / sxx);
    const center = fit.intercept! + fit.slope! * g.t;
    map.set(g.t, { lower: round2(center - Z95 * se), upper: round2(center + Z95 * se) });
  }
  return map;
}

/**
 * 指数模型 95% 预测区间：在对数域用标准公式，再 exp 回原尺度。
 */
function analyticExpInterval(
  positive: TimedPoint[],
  fit: ModelFit,
  grid: { date: string; t: number }[],
): Map<number, { lower: number; upper: number }> {
  const n = positive.length;
  if (n < 3 || fit.expA === undefined || fit.expB === undefined) return new Map();
  const a = fit.expA;
  const b = fit.expB;
  const logResiduals = positive.map((p) => Math.log(p.value) - (a + b * p.t));
  const ssr = logResiduals.reduce((acc, r) => acc + r * r, 0);
  const s = Math.sqrt(ssr / (n - 2));
  const tMean = mean(positive.map((p) => p.t));
  const sxx = positive.reduce((acc, p) => acc + (p.t - tMean) * (p.t - tMean), 0);
  if (sxx <= 0) return new Map();

  const map = new Map<number, { lower: number; upper: number }>();
  for (const g of grid) {
    const se = s * Math.sqrt(1 + 1 / n + ((g.t - tMean) * (g.t - tMean)) / sxx);
    const centerLog = a + b * g.t;
    map.set(g.t, { lower: round2(Math.exp(centerLog - Z95 * se)), upper: round2(Math.exp(centerLog + Z95 * se)) });
  }
  return map;
}

/**
 * 残差 bootstrap 预测区间（可复现，seed 固定）。
 * 对每个未来点：中心预测 + 随机重采样的一个残差，形成 B 条路径，取 p2.5/p97.5。
 * 这是「预测区间」（prediction interval），比置信区间更宽、对应未来单次观测。
 */
export function bootstrapPredictionInterval(
  residuals: number[],
  forecastFn: (t: number) => number,
  grid: { date: string; t: number }[],
  seed = DEFAULT_SEED,
): Map<number, { lower: number; upper: number }> {
  const map = new Map<number, { lower: number; upper: number }>();
  if (residuals.length === 0) return map;
  const rng = new SeededRng(seed);
  const paths: number[][] = grid.map(() => []);
  for (let b = 0; b < BOOTSTRAP_ITERATIONS; b++) {
    grid.forEach((g, i) => {
      const v = forecastFn(g.t) + rng.pick(residuals);
      if (Number.isFinite(v)) paths[i]!.push(v);
    });
  }
  grid.forEach((g, i) => {
    const sorted = paths[i]!.sort((x, y) => x - y);
    if (sorted.length >= 2) {
      map.set(g.t, {
        lower: round2(Math.max(0, quantile(sorted, 0.025))),
        upper: round2(quantile(sorted, 0.975)),
      });
    }
  });
  return map;
}

/** 组装单模型预测结果（中心 + 区间）。 */
export function buildForecast(
  model: Forecast['model'],
  fit: ModelFit,
  points: TimedPoint[],
  horizonDays: number,
  opts: {
    valueFn: (t: number) => number;
    interval?: 'analytic-linear' | 'analytic-exp' | 'bootstrap' | 'none';
    bootstrapResiduals?: number[];
    positive?: TimedPoint[];
    seed?: number;
  },
): Forecast {
  const grid = futureGrid(fit.lastDate, points.length ? points[points.length - 1]!.t : 0, horizonDays);
  const central = centralForecast(grid, opts.valueFn);

  let intervalMap: Map<number, { lower: number; upper: number }> = new Map();
  let intervalType: Forecast['intervalType'] = 'none';
  let intervalNote: string | undefined;

  switch (opts.interval) {
    case 'analytic-linear':
      intervalMap = analyticLinearInterval(points, fit, grid);
      intervalType = 'analytic';
      break;
    case 'analytic-exp':
      intervalMap = analyticExpInterval(opts.positive ?? points.filter((p) => p.value > 0), fit, grid);
      intervalType = 'analytic';
      break;
    case 'bootstrap':
      intervalMap = bootstrapPredictionInterval(opts.bootstrapResiduals ?? [], opts.valueFn, grid, opts.seed);
      intervalType = 'bootstrap';
      break;
    default:
      intervalType = 'none';
  }

  if (intervalMap.size === 0 && opts.interval !== 'none') {
    intervalType = 'none';
    intervalNote = '历史数据不足，暂不显示统计预测区间';
  }

  const pointsWithInterval = central.map((p) => {
    const iv = intervalMap.get(p.t);
    return iv ? { ...p, lower95: iv.lower, upper95: iv.upper } : p;
  });

  return { model, fit, horizonDays, intervalType, intervalNote, points: pointsWithInterval };
}

/**
 * 目标金额到达估计：基于中心/保守/积极三条外推轨迹，估计首次越过目标金额的日期。
 * 若预测下降或不达标，明确返回不可达而非编造日期。
 */
export function estimateGoalDate(
  targetAmount: number,
  lastDate: string,
  lastT: number,
  horizonDays: number,
  central: { slope: number; intercept: number },
  conservative?: { slope: number; intercept: number },
  aggressive?: { slope: number; intercept: number },
): GoalReachEstimate {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    return { reachable: false, reason: '目标金额无效' };
  }

  const solve = (slope: number, intercept: number): string | null => {
    if (slope <= 0) return null; // 不增长 → 无法在预测期内到达
    const tTarget = (targetAmount - intercept) / slope;
    const daysFromLast = tTarget - lastT;
    if (daysFromLast < 0) return lastDate; // 已经达到
    if (daysFromLast > horizonDays) return null; // 超出预测期
    return addDays(lastDate, Math.round(daysFromLast));
  };

  const centralDate = solve(central.slope, central.intercept);
  const conservativeDate = conservative ? solve(conservative.slope, conservative.intercept) : undefined;
  const aggressiveDate = aggressive ? solve(aggressive.slope, aggressive.intercept) : undefined;

  if (!centralDate) {
    return {
      reachable: false,
      reason: central.slope <= 0 ? '预测趋势未上升，无法估计目标到达日期' : `当前预测区间内尚未达到目标（${horizonDays} 天）`,
    };
  }
  return {
    reachable: true,
    centralDate,
    ...(conservativeDate ? { conservativeDate } : {}),
    ...(aggressiveDate ? { aggressiveDate } : {}),
  };
}

/** 供场景/线性外推复用的斜率、截距。 */
export function linearParams(fit: ModelFit): { slope: number; intercept: number } {
  return { slope: fit.slope ?? 0, intercept: fit.intercept ?? 0 };
}
