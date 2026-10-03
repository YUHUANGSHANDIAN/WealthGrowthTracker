import { linearRegression, logLinearRegression, mae, rmse, smape, mean, normalizeWeights } from '../../utils/math';
import type { BacktestMetrics, DataQualityReport, EnsembleWeights, ModelRecommendation, TimedPoint } from './types';
import type { PredictionModelType } from '../../types';

/** 回测至少需要的总数据点数（否则标记为数据不足）。 */
const MIN_POINTS = 6;

/**
 * rolling-origin 时间序列回测（不做随机切分）：
 * 对每个 origin k（从 minTrain 到 n-1），用前 k 个点训练，预测第 k+1 个点，
 * 记录 1-step-ahead 误差，汇总 MAE / RMSE / sMAPE。
 */
export function backtestModel(
  points: TimedPoint[],
  model: Exclude<PredictionModelType, 'hybrid'>,
): BacktestMetrics {
  const n = points.length;
  if (n < MIN_POINTS) {
    return { model, windows: 0, mae: 0, rmse: 0, smape: 0, insufficient: true };
  }

  const minTrain = Math.max(3, Math.floor(n / 2));
  const actuals: number[] = [];
  const preds: number[] = [];

  for (let k = minTrain; k < n; k++) {
    const train = points.slice(0, k);
    const test = points[k]!;
    const f = forecastFn(train, model);
    const p = f(test.t);
    if (Number.isFinite(p)) {
      actuals.push(test.value);
      preds.push(p);
    }
  }

  if (actuals.length === 0) {
    return { model, windows: 0, mae: 0, rmse: 0, smape: 0, insufficient: true };
  }

  return {
    model,
    windows: actuals.length,
    mae: round(mae(actuals, preds)),
    rmse: round(rmse(actuals, preds)),
    smape: round(smape(actuals, preds)),
    insufficient: false,
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 用训练集拟合后，返回在任意未来 t 的预测值函数。 */
function forecastFn(train: TimedPoint[], model: Exclude<PredictionModelType, 'hybrid'>): (t: number) => number {
  const pts = train.map((p) => ({ x: p.t, y: p.value }));
  const reg = linearRegression(pts);
  const last = train[train.length - 1]!;

  switch (model) {
    case 'linear':
      return (t) => reg.intercept + reg.slope * t;
    case 'exponential': {
      const { a, b, used } = logLinearRegression(pts);
      if (used < 2) return () => NaN;
      return (t) => Math.exp(a + b * t);
    }
    case 'conservative':
    case 'aggressive': {
      // 情景模型：线性趋势 ± 1 倍斜率标准误（有统计依据的下/上界斜率）
      const seSlope = slopeStdError(train);
      const slope = model === 'conservative' ? reg.slope - seSlope : reg.slope + seSlope;
      const fittedLast = reg.intercept + reg.slope * last.t;
      return (t) => fittedLast + slope * (t - last.t);
    }
    default:
      return (t) => reg.intercept + reg.slope * t;
  }
}

/** 线性回归斜率的标准误 SE(b) = s / sqrt(Sxx)。 */
function slopeStdError(train: TimedPoint[]): number {
  const n = train.length;
  if (n < 3) return 0;
  const pts = train.map((p) => ({ x: p.t, y: p.value }));
  const reg = linearRegression(pts);
  const residuals = train.map((p) => p.value - (reg.intercept + reg.slope * p.t));
  const ssr = residuals.reduce((a, r) => a + r * r, 0);
  const s = Math.sqrt(ssr / (n - 2));
  const tMean = mean(train.map((p) => p.t));
  const sxx = train.reduce((a, p) => a + (p.t - tMean) * (p.t - tMean), 0);
  if (sxx <= 0) return 0;
  return s / Math.sqrt(sxx);
}

/** 默认权重（回测数据不足时的安全回退）。 */
export const DEFAULT_WEIGHTS: EnsembleWeights = {
  linear: 0.4,
  exponential: 0.3,
  conservative: 0.15,
  aggressive: 0.15,
  source: 'default',
  fallback: true,
};

/**
 * 动态 ensemble 权重：基于各模型 out-of-sample 回测 RMSE 的倒数，并加下限正则化，
 * 防止某个模型因一次异常回测得到 100% 权重。
 */
export function computeEnsembleWeights(backtests: BacktestMetrics[]): EnsembleWeights {
  const byModel = new Map(backtests.map((b) => [b.model, b]));
  const models: Exclude<PredictionModelType, 'hybrid'>[] = ['linear', 'exponential', 'conservative', 'aggressive'];

  const anyInsufficient = models.some((m) => byModel.get(m)?.insufficient ?? true);
  if (anyInsufficient) return DEFAULT_WEIGHTS;

  const rmseBy = models.map((m) => byModel.get(m)!.rmse);
  const eps = Math.max(1, Math.min(...rmseBy) * 0.01);
  const raw = rmseBy.map((r) => 1 / (r + eps));
  const maxRaw = Math.max(...raw);
  const floor = maxRaw * 0.1; // 10% 下限，避免单一模型权重过大
  const normalized = normalizeWeights(raw.map((r) => Math.max(r, floor)));

  return {
    linear: normalized[0]!,
    exponential: normalized[1]!,
    conservative: normalized[2]!,
    aggressive: normalized[3]!,
    source: 'backtest',
    fallback: false,
  };
}

/**
 * 智能模型推荐（基于真实 out-of-sample 回测表现，而非「趋势上涨就选激进」）。
 * 数据不足时回退到线性并明确说明。
 */
export function recommendModel(
  points: TimedPoint[],
  backtests: BacktestMetrics[],
  quality: DataQualityReport,
): ModelRecommendation {
  const n = points.length;
  if (n < MIN_POINTS) {
    return {
      model: 'linear',
      reasons: [`历史数据点仅 ${n} 条，不足以进行可靠回测，采用最稳健的线性外推`],
      notes: ['建议积累更多历史数据后再评估其他模型', '预测仅基于历史外推，不代表投资收益保证'],
      sufficient: false,
    };
  }

  const usable = backtests.filter((b) => !b.insufficient && b.model !== 'conservative' && b.model !== 'aggressive');
  // 场景模型不参与「最佳点预测」推荐；只在 linear / exponential 中选
  const candidates = usable.filter((b) => b.model === 'linear' || b.model === 'exponential');
  if (candidates.length === 0) {
    return {
      model: 'linear',
      reasons: ['未能获得有效回测结果，回退到线性模型'],
      notes: ['预测仅基于历史外推，不代表投资收益保证'],
      sufficient: false,
    };
  }

  candidates.sort((a, b) => a.rmse - b.rmse);
  const best = candidates[0]!;
  const reasons = [
    `在 ${best.windows} 次滚动回测中，「${modelLabel(best.model)}」的 RMSE 最低（${best.rmse}），sMAPE ${best.smape}%`,
    `历史数据 ${quality.pointCount} 个点，时间跨度 ${quality.spanDays} 天，平均间隔 ${quality.avgIntervalDays} 天`,
  ];
  if (quality.anomalies.length > 0) {
    reasons.push(`检测到 ${quality.anomalies.length} 个疑似异常跳变点，建议在「数据质量」中人工确认`);
  }
  return {
    model: best.model,
    reasons,
    notes: [
      '推荐依据为历史外推误差，不代表未来表现',
      '资产变化可能来自工资、储蓄、转账等，不构成投资回报率',
    ],
    sufficient: true,
  };
}

function modelLabel(m: PredictionModelType): string {
  switch (m) {
    case 'linear':
      return '线性增长';
    case 'exponential':
      return '指数增长';
    case 'conservative':
      return '保守情景';
    case 'aggressive':
      return '积极情景';
    case 'hybrid':
      return '混合模型';
  }
}
