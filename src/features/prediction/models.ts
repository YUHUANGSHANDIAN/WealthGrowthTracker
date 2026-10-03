import type { HistoryPoint, PredictionModelType } from '../../types';
import { round2 } from '../../utils/money';
import { coefficientOfVariation } from '../../utils/math';
import type {
  DataQualityReport,
  EnsembleWeights,
  Forecast,
  ModelFit,
  PredictionResult,
  TimedPoint,
} from './types';
import { prepareSeries } from './series';
import { fitLinear, fitExponential, fitScenario, DEFAULT_SEED } from './fit';
import { buildForecast, estimateGoalDate } from './forecast';
import { backtestModel, computeEnsembleWeights, recommendModel } from './backtest';

export { prepareSeries } from './series';

export type {
  Forecast,
  ModelFit,
  PredictionResult,
  DataQualityReport,
  EnsembleWeights,
  BacktestMetrics,
  GoalReachEstimate,
  ModelRecommendation,
  ForecastPoint,
  TimedPoint,
} from './types';

// ---------------------------------------------------------------------------
// 模型元信息（名称/描述已重新定位，不再暗示「投资回报/风险偏好」）
// ---------------------------------------------------------------------------

export interface PredictionModelMeta {
  type: PredictionModelType;
  name: string;
  shortName: string;
  description: string;
  suitable: string;
  color: string;
  icon: string;
}

export const PREDICTION_MODELS: PredictionModelMeta[] = [
  {
    type: 'linear',
    name: '线性增长',
    shortName: '线性',
    description: '对总资产历史轨迹做线性回归外推（每日固定绝对增量）',
    suitable: '资产以近似匀速累积时',
    color: '#2a78d6',
    icon: '📈',
  },
  {
    type: 'exponential',
    name: '指数增长',
    shortName: '指数',
    description: '对总资产做对数域线性回归（每日固定相对增长率）',
    suitable: '资产呈复利式增长时',
    color: '#eb6834',
    icon: '🚀',
  },
  {
    type: 'conservative',
    name: '保守情景',
    shortName: '保守',
    description: '以较低增长斜率外推的下行情景（斜率分布 p10）',
    suitable: '希望看到偏谨慎的轨迹时',
    color: '#1baf7a',
    icon: '🛡️',
  },
  {
    type: 'aggressive',
    name: '积极情景',
    shortName: '积极',
    description: '以较高增长斜率外推的上行情景（斜率分布 p90）',
    suitable: '希望看到偏乐观的轨迹时',
    color: '#4a3aa7',
    icon: '⚡',
  },
  {
    type: 'hybrid',
    name: '混合模型',
    shortName: '混合',
    description: '按历史回测表现动态加权的组合预测',
    suitable: '希望综合多个模型视角时',
    color: '#e87ba4',
    icon: '🧪',
  },
];

/** 预测时间跨度选项（天）。 */
export const HORIZON_OPTIONS = [
  { days: 30, label: '1个月' },
  { days: 90, label: '3个月' },
  { days: 180, label: '6个月' },
  { days: 365, label: '1年' },
  { days: 730, label: '2年' },
] as const;

export function defaultHorizonDays(): number {
  return 180;
}

export function horizonLabel(days: number): string {
  return HORIZON_OPTIONS.find((h) => h.days === days)?.label ?? `${days}天`;
}

// ---------------------------------------------------------------------------
// 单模型预测
// ---------------------------------------------------------------------------

function valueFnOf(model: PredictionModelType, fit: ModelFit): (t: number) => number {
  switch (model) {
    case 'exponential':
      return (t) => Math.exp((fit.expA ?? 0) + (fit.expB ?? 0) * t);
    case 'conservative':
    case 'aggressive':
    case 'linear':
      return (t) => (fit.intercept ?? 0) + (fit.slope ?? 0) * t;
    default:
      return (t) => (fit.intercept ?? 0) + (fit.slope ?? 0) * t;
  }
}

/** 为某个已拟合模型生成完整预测结果（中心线 + 预测区间）。 */
export function forecastForModel(
  model: Exclude<PredictionModelType, 'hybrid'>,
  fit: ModelFit,
  points: TimedPoint[],
  horizonDays: number,
): Forecast {
  const valueFn = valueFnOf(model, fit);
  switch (model) {
    case 'linear':
      return buildForecast('linear', fit, points, horizonDays, {
        valueFn,
        interval: 'analytic-linear',
      });
    case 'exponential':
      return buildForecast('exponential', fit, points, horizonDays, {
        valueFn,
        interval: 'analytic-exp',
        positive: points.filter((p) => p.value > 0),
      });
    case 'conservative':
    case 'aggressive':
      // 情景线本身即代表较低/较高外推，不另附统计区间
      return buildForecast(model, fit, points, horizonDays, {
        valueFn,
        interval: 'none',
      });
  }
}

// ---------------------------------------------------------------------------
// 混合模型（动态 ensemble）
// ---------------------------------------------------------------------------

/** 混合模型：对「适用」的分模型按权重做加权组合，并用残差 bootstrap 生成区间。 */
export function forecastHybrid(
  fits: Record<Exclude<PredictionModelType, 'hybrid'>, ModelFit>,
  points: TimedPoint[],
  weights: EnsembleWeights,
  horizonDays: number,
): Forecast {
  const comps = [
    { model: 'linear' as const, fit: fits.linear, w: weights.linear },
    { model: 'exponential' as const, fit: fits.exponential, w: weights.exponential },
    { model: 'conservative' as const, fit: fits.conservative, w: weights.conservative },
    { model: 'aggressive' as const, fit: fits.aggressive, w: weights.aggressive },
  ].filter((c) => c.fit.suitable && c.w > 0 && Number.isFinite(c.w));

  const usable = comps.length > 0 ? comps : [{ model: 'linear' as const, fit: fits.linear, w: 1 }];
  const totalW = usable.reduce((a, c) => a + c.w, 0) || 1;
  const wMap = new Map(usable.map((c) => [c.model, c.w / totalW]));

  const centralFn = (t: number) => {
    let sum = 0;
    for (const c of usable) {
      sum += (wMap.get(c.model) ?? 0) * valueFnOf(c.model, c.fit)(t);
    }
    return sum;
  };

  // 组合的在样本拟合值与残差（用于 bootstrap 区间）
  const ensembleFitted = points.map((p) => {
    let sum = 0;
    for (const c of usable) sum += (wMap.get(c.model) ?? 0) * valueFnOf(c.model, c.fit)(p.t);
    return sum;
  });
  const residuals = points.map((p, i) => p.value - ensembleFitted[i]!);

  const last = points[points.length - 1] ?? { date: '', t: 0, value: 0 };
  const spanDays = points.length ? points[points.length - 1]!.t - points[0]!.t : 0;
  const hybridFit: ModelFit = {
    model: 'hybrid',
    suitable: true,
    fallback: false,
    n: points.length,
    spanDays,
    mae: 0,
    rmse: 0,
    smape: 0,
    fitted: points.map((p, i) => ({
      date: p.date,
      t: p.t,
      actual: p.value,
      fitted: round2(ensembleFitted[i]!),
      residual: round2(residuals[i]!),
    })),
    lastValue: last.value,
    lastDate: last.date,
  };

  const forecast = buildForecast('hybrid', hybridFit, points, horizonDays, {
    valueFn: centralFn,
    interval: 'bootstrap',
    bootstrapResiduals: residuals,
    seed: DEFAULT_SEED,
  });
  return forecast;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 生成完整预测结果（含数据质量、拟合、预测、回测、推荐、混合）。 */
export function runPrediction(history: HistoryPoint[], horizonDays = defaultHorizonDays()): PredictionResult {
  const { points, quality } = prepareSeries(history);

  const fits = {
    linear: fitLinear(points),
    exponential: fitExponential(points),
    conservative: fitScenario(points, 'conservative', DEFAULT_SEED),
    aggressive: fitScenario(points, 'aggressive', DEFAULT_SEED),
  };

  const forecasts = {
    linear: forecastForModel('linear', fits.linear, points, horizonDays),
    exponential: forecastForModel('exponential', fits.exponential, points, horizonDays),
    conservative: forecastForModel('conservative', fits.conservative, points, horizonDays),
    aggressive: forecastForModel('aggressive', fits.aggressive, points, horizonDays),
  };

  const backtests = [
    backtestModel(points, 'linear'),
    backtestModel(points, 'exponential'),
    backtestModel(points, 'conservative'),
    backtestModel(points, 'aggressive'),
  ];

  const weights = computeEnsembleWeights(backtests);
  const hybrid = forecastHybrid(fits, points, weights, horizonDays);
  const recommendation = recommendModel(points, backtests, quality);

  return {
    dataQuality: quality,
    fits,
    forecasts,
    hybrid,
    weights,
    backtests,
    recommendation,
  };
}

/** 目标金额到达估计。 */
export { estimateGoalDate };

/** 数据质量。 */
export function analyzeDataQuality(history: HistoryPoint[]): DataQualityReport {
  return prepareSeries(history).quality;
}

// ---------------------------------------------------------------------------
// 雷达图维度（供分析页使用，基于线性拟合与数据质量的真实指标）
// ---------------------------------------------------------------------------

export function analyzeDimensions(history: HistoryPoint[]): {
  dimension: string;
  value: number;
  description: string;
  color: string;
}[] {
  const { points } = prepareSeries(history);
  const fit = fitLinear(points);

  // 增长趋势：日斜率相对最后资产值的强度（年化近似）
  const lastValue = fit.lastValue > 0 ? fit.lastValue : 1;
  const annualized = (fit.slope ?? 0) * 365;
  const trendValue = Math.round(Math.max(0, Math.min(1, annualized / lastValue)) * 100);

  // 拟合质量：R²
  const r2 = fit.r2 ?? 0;
  const qualityValue = Math.round(Math.max(0, Math.min(1, r2)) * 100);

  // 数据规则性：1 - 变异系数（残差波动）
  const residuals = fit.fitted.map((f) => f.residual);
  const cv = residuals.length ? coefficientOfVariation(residuals) : 1;
  const regularityValue = Math.round(Math.max(0, Math.min(1, 1 - Math.min(1, cv))) * 100);

  return [
    { dimension: '增长趋势', value: trendValue, description: '年化增速/资产', color: '#2a78d6' },
    { dimension: '拟合质量', value: qualityValue, description: '线性回归 R²', color: '#eb6834' },
    { dimension: '数据规则性', value: regularityValue, description: '残差变异系数', color: '#1baf7a' },
  ];
}
