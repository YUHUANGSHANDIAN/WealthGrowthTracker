import { describe, it, expect } from 'vitest';
import type { HistoryPoint } from '../../src/types';
import { addDays } from '../../src/utils/date';
import {
  runPrediction,
  forecastForModel,
  prepareSeries,
  estimateGoalDate,
  analyzeDataQuality,
} from '../../src/features/prediction/models';
import { fitLinear, fitExponential } from '../../src/features/prediction/fit';
import {
  backtestModel,
  computeEnsembleWeights,
  DEFAULT_WEIGHTS,
} from '../../src/features/prediction/backtest';
import { bootstrapPredictionInterval, niceInterval } from '../../src/features/prediction/forecast';

/** 生成从 startDate 起、间隔 intervalDays 天、共 n 条的历史序列。 */
function makeSeries(
  startDate: string,
  n: number,
  valueAt: (i: number) => number,
  intervalDays = 7,
): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ date: addDays(startDate, i * intervalDays), totalAmount: valueAt(i) });
  }
  return out;
}

describe('预测引擎：时间轴', () => {
  it('使用真实 elapsed days，而非索引', () => {
    const history = [
      { date: '2026-01-01', totalAmount: 100 },
      { date: '2026-01-02', totalAmount: 101 },
      { date: '2026-02-20', totalAmount: 110 }, // 与上一点间隔 49 天
    ];
    const { points } = prepareSeries(history);
    expect(points[1]!.t).toBe(1);
    expect(points[2]!.t).toBe(50); // 1/1 → 2/20 = 50 天
  });

  it('排序并合并重复日期（保留最后一条）', () => {
    const history = [
      { date: '2026-01-03', totalAmount: 300 },
      { date: '2026-01-01', totalAmount: 100 },
      { date: '2026-01-01', totalAmount: 150 }, // 重复，保留 150
    ];
    const { points, quality } = prepareSeries(history);
    expect(points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-03']);
    expect(points[0]!.value).toBe(150);
    expect(quality.hadDuplicates).toBe(true);
  });
});

describe('预测引擎：线性模型', () => {
  it('完美线性数据：参数正确、R²≈1、无指数爆炸', () => {
    // y = 100 + 10·t（t 为 elapsed days，间隔 7 天）
    const history = makeSeries('2026-01-01', 20, (i) => 100 + 10 * i * 7);
    const { points } = prepareSeries(history);
    const fit = fitLinear(points);
    expect(fit.suitable).toBe(true);
    expect(fit.slope!).toBeCloseTo(10, 5);
    expect(fit.intercept!).toBeCloseTo(100, 5);
    expect(fit.r2!).toBeGreaterThan(0.999);

    const forecast = forecastForModel('linear', fit, points, 180);
    // 真正的线性外推：未来第 180 天 = 100 + 10*(lastT+180)
    const lastT = points[points.length - 1]!.t;
    const expectedEnd = 100 + 10 * (lastT + 180);
    expect(forecast.points[forecast.points.length - 1]!.value).toBeCloseTo(expectedEnd, 2);
    // 不是复合增长（复合会更大）
    const naiveCompound = fit.lastValue * Math.pow(1.1, 180 / 7);
    expect(forecast.points[forecast.points.length - 1]!.value).toBeLessThan(naiveCompound);
  });

  it('线性模型带解析 95% 预测区间', () => {
    // 带轻微噪声的线性数据，使区间有非零宽度
    const history = makeSeries('2026-01-01', 20, (i) => 100 + 10 * i * 7 + ((i % 3) - 1) * 2);
    const { points } = prepareSeries(history);
    const fit = fitLinear(points);
    const forecast = forecastForModel('linear', fit, points, 180);
    expect(forecast.intervalType).toBe('analytic');
    const last = forecast.points[forecast.points.length - 1]!;
    expect(last.lower95).toBeDefined();
    expect(last.upper95).toBeDefined();
    expect(last.upper95!).toBeGreaterThan(last.lower95!);
  });

  it('恒定资产：无 NaN、无 Infinity、不莫名增长', () => {
    const history = makeSeries('2026-01-01', 15, () => 5000);
    const { points } = prepareSeries(history);
    const fit = fitLinear(points);
    expect(fit.slope!).toBeCloseTo(0, 5);
    expect(Number.isFinite(fit.rmse)).toBe(true);
    const forecast = forecastForModel('linear', fit, points, 365);
    for (const p of forecast.points) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(Math.abs(p.value - 5000)).toBeLessThan(1);
    }
  });

  it('下降趋势：不得产生错误正增长', () => {
    const history = makeSeries('2026-01-01', 12, (i) => 1000 - 10 * i * 7);
    const { points } = prepareSeries(history);
    const fit = fitLinear(points);
    expect(fit.slope!).toBeLessThan(0);
    const forecast = forecastForModel('linear', fit, points, 90);
    expect(forecast.points[forecast.points.length - 1]!.value).toBeLessThan(fit.lastValue);
  });

  it('大金额（1 亿）不溢出、精度正常', () => {
    const history = makeSeries('2026-01-01', 10, (i) => 100_000_000 + i * 100_000);
    const { points } = prepareSeries(history);
    const fit = fitLinear(points);
    expect(Number.isFinite(fit.slope!)).toBe(true);
    const forecast = forecastForModel('linear', fit, points, 365);
    expect(Number.isFinite(forecast.points[forecast.points.length - 1]!.value)).toBe(true);
  });
});

describe('预测引擎：指数模型', () => {
  it('完美指数数据：log-linear 拟合正确', () => {
    // y = 100 * 1.01^t
    const history = makeSeries('2026-01-01', 30, (i) => 100 * Math.pow(1.01, i * 7));
    const { points } = prepareSeries(history);
    const fit = fitExponential(points);
    expect(fit.suitable).toBe(true);
    // expB 应接近 ln(1.01) ≈ 0.00995
    expect(fit.expB!).toBeCloseTo(Math.log(1.01), 4);
    // expA 应接近 ln(100)
    expect(fit.expA!).toBeCloseTo(Math.log(100), 3);
  });

  it('包含 0 值时指数模型正确处理（仅用正数点）', () => {
    const history = makeSeries('2026-01-01', 8, (i) => (i === 0 ? 0 : 100 * Math.pow(1.02, i)));
    const { points } = prepareSeries(history);
    const fit = fitExponential(points);
    expect(fit.suitable).toBe(true);
    expect(fit.n).toBeGreaterThanOrEqual(7); // 去掉 0 点
    expect(Number.isFinite(fit.expB!)).toBe(true);
  });

  it('数据不足（<2 正数点）时标记不适用而非返回假结果', () => {
    const { points } = prepareSeries([{ date: '2026-01-01', totalAmount: 0 }]);
    const fit = fitExponential(points);
    expect(fit.suitable).toBe(false);
    expect(fit.notSuitableReason).toBeTruthy();
  });
});

describe('预测引擎：保守/积极情景', () => {
  it('保守情景低于中心线性，积极情景高于中心线性', () => {
    const history = makeSeries('2026-01-01', 20, (i) => 100 + 10 * i * 7 + ((i % 3) - 1) * 3);
    const { points } = prepareSeries(history);
    const linear = fitLinear(points);
    const result = runPrediction(history, 180);
    const endCons = result.forecasts.conservative.points[result.forecasts.conservative.points.length - 1]!.value;
    const endLinear = result.forecasts.linear.points[result.forecasts.linear.points.length - 1]!.value;
    const endAgg = result.forecasts.aggressive.points[result.forecasts.aggressive.points.length - 1]!.value;
    expect(endCons).toBeLessThan(endLinear);
    expect(endAgg).toBeGreaterThan(endLinear);
    expect(linear.slope!).toBeGreaterThan(result.fits.conservative.slope!);
    expect(result.fits.aggressive.slope!).toBeGreaterThan(linear.slope!);
  });
});

describe('预测引擎：混合模型与回测', () => {
  it('权重总和 ≈ 1', () => {
    const history = makeSeries('2026-01-01', 20, (i) => 100 + 10 * i * 7 + (i % 3) * 5);
    const result = runPrediction(history, 180);
    const w = result.weights;
    const sum = w.linear + w.exponential + w.conservative + w.aggressive;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('数据不足时回退到默认权重', () => {
    const history = makeSeries('2026-01-01', 3, (i) => 100 + i);
    const { points } = prepareSeries(history);
    const backtests = [
      backtestModel(points, 'linear'),
      backtestModel(points, 'exponential'),
      backtestModel(points, 'conservative'),
      backtestModel(points, 'aggressive'),
    ];
    const weights = computeEnsembleWeights(backtests);
    expect(weights.fallback).toBe(true);
    expect(weights.source).toBe('default');
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('rolling backtest 在充足数据下产生窗口与有限指标', () => {
    const history = makeSeries('2026-01-01', 20, (i) => 100 + 10 * i * 7);
    const { points } = prepareSeries(history);
    const bt = backtestModel(points, 'linear');
    expect(bt.insufficient).toBe(false);
    expect(bt.windows).toBeGreaterThan(0);
    expect(Number.isFinite(bt.rmse)).toBe(true);
    expect(Number.isFinite(bt.smape)).toBe(true);
  });
});

describe('预测引擎：bootstrap 可复现', () => {
  it('固定 seed 得到相同区间', () => {
    const residuals = [-3, 5, -2, 8, -1, 2, 4, -5, 3, 1];
    const grid = [10, 20, 30, 40].map((t) => ({ date: addDays('2026-01-01', t), t }));
    const f = (t: number) => 100 + t;
    const a = bootstrapPredictionInterval(residuals, f, grid, 42);
    const b = bootstrapPredictionInterval(residuals, f, grid, 42);
    expect(a.get(10)).toEqual(b.get(10));
  });

  it('区间上界 >= 下界', () => {
    const residuals = [-3, 5, -2, 8, -1, 2, 4, -5, 3, 1];
    const grid = [10, 20, 30].map((t) => ({ date: addDays('2026-01-01', t), t }));
    const f = (t: number) => 100 + t;
    const iv = bootstrapPredictionInterval(residuals, f, grid, 7);
    for (const g of grid) {
      const v = iv.get(g.t)!;
      expect(v.upper).toBeGreaterThanOrEqual(v.lower);
    }
  });
});

describe('预测引擎：目标到达与数据质量', () => {
  it('上升趋势：估计到达日期；下降趋势：不编造日期', () => {
    const up = estimateGoalDate(2000, '2026-06-01', 150, 365, { slope: 10, intercept: 100 }, { slope: 8, intercept: 100 }, { slope: 12, intercept: 100 });
    expect(up.reachable).toBe(true);
    expect(up.centralDate).toBeTruthy();

    const down = estimateGoalDate(2000, '2026-06-01', 150, 365, { slope: -10, intercept: 5000 });
    expect(down.reachable).toBe(false);
  });

  it('数据质量：检测异常跳变与跨度', () => {
    const history = [
      { date: '2026-01-01', totalAmount: 100 },
      { date: '2026-01-08', totalAmount: 500 }, // 5x 跳变
      { date: '2026-01-15', totalAmount: 550 },
    ];
    const q = analyzeDataQuality(history);
    expect(q.pointCount).toBe(3);
    expect(q.spanDays).toBe(14);
    expect(q.anomalies.length).toBeGreaterThan(0);
  });

  it('niceInterval 控制采样密度（2 年不超过 ~30 点）', () => {
    const interval = niceInterval(730);
    const count = Math.ceil(730 / interval);
    expect(count).toBeLessThanOrEqual(30);
  });
});
