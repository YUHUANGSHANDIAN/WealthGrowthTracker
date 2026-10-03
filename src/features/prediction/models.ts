import type {
  HistoryPoint,
  PredictionModelType,
  PredictionPoint,
  PredictionStats,
} from '../../types';
import {
  coefficientOfVariation,
  compoundGrowthRate,
  linearRegression,
  periodGrowthRates,
  weightedLinearRegression,
} from '../../utils/math';
import { addDays, daysBetween } from '../../utils/date';
import { round2 } from '../../utils/money';

/**
 * 预测模型定义（纯本地规则算法，不调用任何外部 AI/网络服务）。
 *
 * 注意：预测结果只是对历史数据的数学外推，**不代表投资收益保证**。
 * 保守/激进模型是在基础增长率上做风险调节的经验式模型，并非真实市场预测。
 */

export interface PredictionModelMeta {
  type: PredictionModelType;
  name: string;
  description: string;
  suitable: string;
  color: string;
  icon: string;
}

export const PREDICTION_MODELS: PredictionModelMeta[] = [
  {
    type: 'linear',
    name: '线性增长',
    description: '基于历史平均增长率的稳定预测',
    suitable: '适合短期趋势分析（3-6个月）',
    color: '#06b6d4',
    icon: '📈',
  },
  {
    type: 'exponential',
    name: '指数增长',
    description: '基于复利效应的乐观预测',
    suitable: '适合长期趋势分析（1年以上）',
    color: '#f97316',
    icon: '🚀',
  },
  {
    type: 'conservative',
    name: '保守预测',
    description: '考虑风险和波动的谨慎预测',
    suitable: '适合中期趋势分析（6个月-2年）',
    color: '#f59e0b',
    icon: '🛡️',
  },
  {
    type: 'aggressive',
    name: '激进预测',
    description: '追求高收益的积极预测',
    suitable: '适合风险偏好较高的场景',
    color: '#ef4444',
    icon: '⚡',
  },
  {
    type: 'hybrid',
    name: '混合模型',
    description: '综合多个模型的预测结果',
    suitable: '适合需要平衡视角的场景',
    color: '#ec4899',
    icon: '🧪',
  },
];

/** 计算历史数据的统计摘要：波动率、趋势、置信度。 */
export function computeStats(history: HistoryPoint[]): PredictionStats {
  const values = history.map((h) => h.totalAmount);
  const rates = periodGrowthRates(history);
  const volatility = Math.min(1, coefficientOfVariation(rates));
  const trend =
    values.length >= 2
      ? values[values.length - 1]! > values[0]!
        ? 'increasing'
        : values[values.length - 1]! < values[0]!
          ? 'decreasing'
          : 'stable'
      : 'stable';

  let confidence = 0;
  if (history.length >= 3) {
    const { r2 } = linearRegression(
      history.map((h, i) => ({ x: i, y: h.totalAmount })),
    );
    confidence = Math.max(0, Math.min(1, r2 * (1 - volatility)));
  }
  return { volatility, trend, confidence };
}

/** 估算日均增长率（线性模型的斜率换算为相对增长率）。 */
function linearDailyRate(history: HistoryPoint[]): number {
  const points = history.map((h, i) => ({ x: i, y: h.totalAmount }));
  const { slope } = weightedLinearRegression(points, 0.9);
  const last = history[history.length - 1]!.totalAmount;
  if (last <= 0) return 0;
  return slope / last;
}

/** 指数模型：复合年化增长率 → 日均增长率。 */
function exponentialDailyRate(history: HistoryPoint[]): number {
  const first = history[0]!.totalAmount;
  const last = history[history.length - 1]!.totalAmount;
  const days = daysBetween(history[0]!.date, history[history.length - 1]!.date);
  const annual = compoundGrowthRate(first, last, days);
  return Math.pow(1 + annual, 1 / 365) - 1;
}

/** 由历史数据生成预测序列（逐日复利/线性累加，按 intervalDays 采样）。 */
export function predictSeries(
  history: HistoryPoint[],
  dailyRate: number,
  horizonDays: number,
  modelType: PredictionModelType,
  intervalDays = 7,
): PredictionPoint[] {
  if (history.length === 0) return [];
  const start = history[history.length - 1]!;
  const base = start.totalAmount;
  const points: PredictionPoint[] = [];

  for (let d = intervalDays; d <= horizonDays; d += intervalDays) {
    const amount = round2(base * Math.pow(1 + dailyRate, d));
    points.push({
      date: addDays(start.date, d),
      totalAmount: amount,
      isPrediction: true,
      modelType,
    });
  }
  // 确保终点被包含
  const lastDate = addDays(start.date, horizonDays);
  if (points.length === 0 || points[points.length - 1]!.date !== lastDate) {
    points.push({
      date: lastDate,
      totalAmount: round2(base * Math.pow(1 + dailyRate, horizonDays)),
      isPrediction: true,
      modelType,
    });
  }
  return points;
}

/** 单个模型的预测序列。 */
export function predictWithModel(
  history: HistoryPoint[],
  modelType: Exclude<PredictionModelType, 'hybrid'>,
  horizonDays: number,
): PredictionPoint[] {
  const stats = computeStats(history);
  const baseLinear = linearDailyRate(history);
  const baseExponential = exponentialDailyRate(history);

  let dailyRate: number;
  switch (modelType) {
    case 'linear':
      dailyRate = baseLinear;
      break;
    case 'exponential':
      dailyRate = baseExponential;
      break;
    case 'conservative': {
      // 保守：以线性/指数中较低者为基础，再按波动率、置信度下调 12%~30%
      const base = Math.min(baseLinear, baseExponential);
      const confidenceFactor = 0.88 + stats.confidence * 0.12;
      const volatilityFactor = Math.max(0.7, 1 - stats.volatility * 0.3);
      dailyRate = base * confidenceFactor * volatilityFactor;
      break;
    }
    case 'aggressive': {
      // 激进：以两者较高者为基础，趋势向上时加成，置信度高时再加成
      let base = Math.max(baseLinear, baseExponential);
      if (stats.trend === 'increasing') base *= 1.15;
      if (stats.confidence > 0.7) base *= 1.1;
      dailyRate = base;
      break;
    }
    default:
      dailyRate = baseLinear;
  }
  return predictSeries(history, dailyRate, horizonDays, modelType);
}

export interface HybridWeights {
  linear: number;
  exponential: number;
  conservative: number;
  aggressive: number;
}

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  linear: 0.25,
  exponential: 0.25,
  conservative: 0.25,
  aggressive: 0.25,
};

/** 混合模型：对四个模型的逐日金额做加权平均。 */
export function predictHybrid(
  history: HistoryPoint[],
  horizonDays: number,
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS,
): PredictionPoint[] {
  const modelTypes: Exclude<PredictionModelType, 'hybrid'>[] = [
    'linear',
    'exponential',
    'conservative',
    'aggressive',
  ];
  const seriesMap = new Map<string, { amount: number; weight: number }>();

  for (const mt of modelTypes) {
    const w = weights[mt];
    if (w <= 0) continue;
    const series = predictWithModel(history, mt, horizonDays);
    for (const p of series) {
      const prev = seriesMap.get(p.date) ?? { amount: 0, weight: 0 };
      prev.amount += p.totalAmount * w;
      prev.weight += w;
      seriesMap.set(p.date, prev);
    }
  }

  return [...seriesMap.entries()]
    .map(([date, { amount, weight }]) => ({
      date,
      totalAmount: round2(weight > 0 ? amount / weight : 0),
      isPrediction: true as const,
      modelType: 'hybrid' as const,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface RiskLevel {
  level: 'low' | 'medium' | 'high';
  label: string;
}

/** 本地规则式「AI」选型：根据阶段、波动率、趋势、置信度推荐模型与建议文案。 */
export function recommendModel(
  history: HistoryPoint[],
  goalProgress: number,
): {
  model: Exclude<PredictionModelType, 'hybrid'>;
  risk: RiskLevel;
  reasons: string[];
  advice: string[];
} {
  const stats = computeStats(history);
  const n = history.length;
  let model: Exclude<PredictionModelType, 'hybrid'> = 'linear';
  let risk: RiskLevel = { level: 'medium', label: '中等风险' };
  const reasons: string[] = [];
  const advice: string[] = [];

  if (n < 3) {
    model = 'linear';
    risk = { level: 'medium', label: '中等风险' };
    reasons.push('历史数据较少，采用最稳健的线性模型');
    advice.push('建议先积累更多历史数据，再评估其他模型');
  } else if (goalProgress >= 0.9) {
    model = 'conservative';
    risk = { level: 'low', label: '低风险' };
    reasons.push(`接近目标阶段（${(goalProgress * 100).toFixed(0)}%），建议采用保守策略确保达成目标`);
    advice.push('临近目标，建议控制风险，避免功亏一篑');
  } else if (stats.volatility > 0.7) {
    model = 'conservative';
    risk = { level: 'low', label: '低风险' };
    reasons.push(`历史数据波动较大（${(stats.volatility * 100).toFixed(1)}%），建议采用保守预测以控制风险`);
    advice.push('高波动性环境下，需要更谨慎的资产配置');
  } else if (stats.trend === 'increasing' && stats.confidence > 0.7) {
    model = 'aggressive';
    risk = { level: 'high', label: '高风险' };
    reasons.push('趋势向上且置信度高，可考虑积极策略');
    advice.push('顺势而为，但需设置止盈与回撤保护');
  } else if (stats.volatility < 0.2 && stats.confidence > 0.7) {
    model = 'linear';
    risk = { level: 'low', label: '低风险' };
    reasons.push('数据质量良好，趋势稳定，线性预测最为可靠');
    advice.push('稳定环境下，稳健增长策略最为可取');
  } else {
    model = 'linear';
    risk = { level: 'medium', label: '中等风险' };
    reasons.push('综合数据特征，选择稳健的线性策略');
    advice.push('定期复盘，保持策略一致性');
  }

  return { model, risk, reasons, advice };
}

/** 雷达图维度：增长趋势（斜率）、增长稳定性（变异系数）、预测准确性（R²）。 */
export function analyzeDimensions(history: HistoryPoint[]) {
  const stats = computeStats(history);
  const trendValue =
    history.length >= 2
      ? Math.round(
          Math.max(
            0,
            Math.min(1, Math.abs(linearDailyRate(history)) * 1000),
          ) * 100,
        )
      : 0;
  const stabilityValue = Math.round((1 - stats.volatility) * 100);
  const accuracyValue = Math.round(stats.confidence * 100);

  return [
    { dimension: '增长趋势', value: trendValue, description: '线性回归斜率', color: '#10b981' },
    { dimension: '增长稳定性', value: stabilityValue, description: '变异系数', color: '#3b82f6' },
    { dimension: '预测准确性', value: accuracyValue, description: '历史拟合度', color: '#8b5cf6' },
  ];
}

/** 预测默认时间跨度（天）。 */
export function defaultHorizonDays(): number {
  // 默认预测到 180 天之后，或至少覆盖今天之后 30 天。
  return 180;
}

/** 生成「AI 预测」的整体结果（本地规则，供 UI 调用）。 */
export function runPrediction(history: HistoryPoint[], goalProgress: number) {
  const horizon = defaultHorizonDays();
  const rec = recommendModel(history, goalProgress);
  const series = predictWithModel(history, rec.model, horizon);
  const hybrid = predictHybrid(history, horizon);
  const dimensions = analyzeDimensions(history);
  return { rec, series, hybrid, dimensions, horizon, stats: computeStats(history) };
}
