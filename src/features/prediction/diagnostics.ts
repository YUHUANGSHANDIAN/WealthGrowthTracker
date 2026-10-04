import type { HistoryPoint, PredictionModelType } from '../../types';
import { addDays } from '../../utils/date';
import { round2 } from '../../utils/money';
import { mae, rmse, smape } from '../../utils/math';
import { prepareSeries } from './series';
import { forecastFn } from './backtest';
import type { TimedPoint, Forecast } from './types';
import { runPrediction } from './models';

/**
 * 预测诊断增强（v1.3）：训练窗口敏感性、Horizon Backtest、模型分歧、异常点敏感性、目标所需轨迹。
 * 均为纯函数、确定性。数学外推，不构成收益保证。
 */

export type IntervalLevel = 80 | 90 | 95;

/** 各预测区间等级对应的正态分位。 */
export const INTERVAL_Z: Record<IntervalLevel, number> = { 80: 1.282, 90: 1.645, 95: 1.96 };

const TRAINING_WINDOWS = [
  { key: '90d', days: 90 },
  { key: '180d', days: 180 },
  { key: '365d', days: 365 },
  { key: 'all', days: null },
] as const;

type NonHybrid = Exclude<PredictionModelType, 'hybrid'>;
const MODELS: NonHybrid[] = ['linear', 'exponential', 'conservative', 'aggressive'];

function terminal(points: TimedPoint[], days: number | null): TimedPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (days === null || sorted.length === 0) return sorted;
  const last = sorted[sorted.length - 1]!;
  const cutoff = last.t - days;
  return sorted.filter((p) => p.t >= cutoff);
}

/** 训练窗口敏感性：同一模型在不同窗口下预测终值差异。 */
export interface WindowSensitivity {
  window: string;
  days: number | null;
  terminalByModel: Record<NonHybrid, number | null>;
}

export function trainingWindowSensitivity(history: HistoryPoint[], horizonDays: number): WindowSensitivity[] {
  const { points } = prepareSeries(history);
  return TRAINING_WINDOWS.map((w) => {
    const train = terminal(points, w.days);
    const terminalByModel = {} as Record<NonHybrid, number | null>;
    for (const m of MODELS) {
      if (train.length < 3) { terminalByModel[m] = null; continue; }
      const fn = forecastFn(train, m);
      const lastT = train[train.length - 1]!.t;
      const v = fn(lastT + horizonDays);
      terminalByModel[m] = Number.isFinite(v) ? round2(v) : null;
    }
    return { window: w.key, days: w.days, terminalByModel };
  });
}

/** 某模型不同窗口预测终值的最大差（相对均值），用于提示「预测对历史窗口较敏感」。 */
export function windowSpread(ws: WindowSensitivity[], model: NonHybrid): { spreadPct: number } | null {
  const values = ws.map((w) => w.terminalByModel[model]).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return null;
  return { spreadPct: round2(((max - min) / mean) * 100) };
}

/** Horizon Backtest：rolling-origin h 步前外推误差（按预测跨度 30/90/180）。 */
export interface HorizonBacktestMetrics {
  model: NonHybrid;
  horizonDays: number;
  windows: number;
  mae: number;
  rmse: number;
  smape: number;
  insufficient: boolean;
}

export function horizonBacktest(history: HistoryPoint[], model: NonHybrid, horizonDays: number): HorizonBacktestMetrics {
  const { points } = prepareSeries(history);
  const n = points.length;
  const minTrain = Math.max(3, Math.floor(n / 2));
  const actuals: number[] = [];
  const preds: number[] = [];

  for (let k = minTrain; k < n; k++) {
    const train = points.slice(0, k);
    const originT = points[k - 1]!.t;
    const targetT = originT + horizonDays;
    // 找目标日附近（±3 天）的真实点作为 ground truth
    let ground: TimedPoint | null = null;
    for (let j = k; j < n; j++) {
      if (Math.abs(points[j]!.t - targetT) <= 3) { ground = points[j]!; break; }
    }
    if (!ground) continue;
    const fn = forecastFn(train, model);
    const p = fn(targetT);
    if (Number.isFinite(p)) {
      actuals.push(ground.value);
      preds.push(p);
    }
  }

  if (actuals.length === 0) {
    return { model, horizonDays, windows: 0, mae: 0, rmse: 0, smape: 0, insufficient: true };
  }
  return {
    model,
    horizonDays,
    windows: actuals.length,
    mae: round2(mae(actuals, preds)),
    rmse: round2(rmse(actuals, preds)),
    smape: round2(smape(actuals, preds)),
    insufficient: false,
  };
}

/** 模型分歧：同一预测日期五种模型最高值 - 最低值（代表模型不确定性，非风险概率）。 */
export interface DisagreementPoint {
  date: string;
  spread: number;
  max: number;
  min: number;
}

export function modelDisagreement(forecasts: Forecast[]): DisagreementPoint[] {
  const byDate = new Map<string, number[]>();
  for (const f of forecasts) {
    for (const p of f.points) {
      const arr = byDate.get(p.date) ?? [];
      arr.push(p.value);
      byDate.set(p.date, arr);
    }
  }
  const out: DisagreementPoint[] = [];
  for (const [date, values] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (values.length < 2) continue;
    const max = Math.max(...values);
    const min = Math.min(...values);
    out.push({ date, spread: round2(max - min), max, min });
  }
  return out;
}

/** 异常点敏感性：包含 vs 分析时排除已标记异常点，比较预测终值。默认包含全部真实数据。 */
export interface OutlierSensitivity {
  withOutliers: number | null;
  withoutOutliers: number | null;
  diffPct: number | null;
}

export function outlierSensitivity(history: HistoryPoint[], horizonDays: number): OutlierSensitivity {
  const { quality } = prepareSeries(history);
  const anomalyDates = new Set(quality.anomalies.map((a) => a.date));
  const withResult = runPrediction(history, horizonDays);
  const withEnd = withResult.hybrid.points[withResult.hybrid.points.length - 1]?.value ?? null;

  if (anomalyDates.size === 0) {
    return { withOutliers: withEnd, withoutOutliers: withEnd, diffPct: 0 };
  }
  const cleaned = history.filter((h) => !anomalyDates.has(h.date));
  const withoutResult = runPrediction(cleaned, horizonDays);
  const withoutEnd = withoutResult.hybrid.points[withoutResult.hybrid.points.length - 1]?.value ?? null;

  const diffPct = withEnd != null && withoutEnd != null && withEnd > 0
    ? round2(((withoutEnd - withEnd) / withEnd) * 100)
    : null;
  return { withOutliers: withEnd, withoutOutliers: withoutEnd, diffPct };
}

/** 目标所需轨迹：当前资产 → 目标日期的线性所需路径（不代表投资收益率）。 */
export function goalRequiredPath(currentTotal: number, targetAmount: number, lastDate: string, targetDate: string): { date: string; value: number }[] {
  if (targetAmount <= 0 || targetDate <= lastDate) return [];
  const totalDays = Math.round((Date.parse(targetDate) - Date.parse(lastDate)) / 86_400_000);
  if (totalDays <= 0) return [];
  const points: { date: string; value: number }[] = [{ date: lastDate, value: currentTotal }];
  const steps = Math.min(totalDays, 24);
  for (let i = 1; i <= steps; i++) {
    const days = Math.round((totalDays * i) / steps);
    const value = currentTotal + ((targetAmount - currentTotal) * i) / steps;
    points.push({ date: addDays(lastDate, days), value: round2(value) });
  }
  return points;
}
