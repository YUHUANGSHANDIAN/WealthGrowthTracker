import { describe, it, expect } from 'vitest';
import type { HistoryPoint } from '../../src/types';
import { addDays } from '../../src/utils/date';
import { runPrediction } from '../../src/features/prediction/models';
import {
  trainingWindowSensitivity,
  windowSpread,
  horizonBacktest,
  modelDisagreement,
  outlierSensitivity,
  goalRequiredPath,
  INTERVAL_Z,
} from '../../src/features/prediction/diagnostics';

function makeSeries(n: number, valueAt: (i: number) => number): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (let i = 0; i < n; i++) out.push({ date: addDays('2026-01-01', i * 7), totalAmount: valueAt(i) });
  return out;
}

describe('预测诊断增强', () => {
  it('训练窗口敏感性返回多个窗口', () => {
    const history = makeSeries(80, (i) => 1000 + i * 50);
    const ws = trainingWindowSensitivity(history, 180);
    expect(ws.map((w) => w.window)).toEqual(['90d', '180d', '365d', 'all']);
    expect(ws[3]!.terminalByModel.linear).toBeDefined();
  });

  it('windowSpread 计算相对差异', () => {
    const history = makeSeries(80, (i) => 1000 + i * 50 + (i % 5) * 30);
    const ws = trainingWindowSensitivity(history, 180);
    const spread = windowSpread(ws, 'linear');
    expect(spread).not.toBeNull();
    expect(spread!.spreadPct).toBeGreaterThanOrEqual(0);
  });

  it('horizonBacktest 产生有限指标或标记不足', () => {
    const history = makeSeries(40, (i) => 1000 + i * 20);
    const bt = horizonBacktest(history, 'linear', 30);
    expect(bt.horizonDays).toBe(30);
    expect(bt.insufficient === false ? Number.isFinite(bt.rmse) : true).toBe(true);
  });

  it('modelDisagreement：分歧 >= 0', () => {
    const history = makeSeries(30, (i) => 1000 + i * 30);
    const result = runPrediction(history, 180);
    const forecasts = [result.forecasts.linear, result.forecasts.exponential, result.forecasts.conservative, result.forecasts.aggressive, result.hybrid];
    const dis = modelDisagreement(forecasts);
    expect(dis.length).toBeGreaterThan(0);
    for (const d of dis) expect(d.spread).toBeGreaterThanOrEqual(0);
  });

  it('outlierSensitivity 比较包含/排除异常点', () => {
    const history = makeSeries(30, (i) => (i === 15 ? 99999 : 1000 + i * 20));
    const s = outlierSensitivity(history, 180);
    expect(s.withOutliers).not.toBeNull();
  });

  it('goalRequiredPath 生成线性所需路径', () => {
    const path = goalRequiredPath(300_000, 1_000_000, '2026-01-01', '2028-12-31');
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]!.value).toBe(300_000);
    expect(path[path.length - 1]!.value).toBe(1_000_000);
  });

  it('区间等级：80 < 90 < 95 的 Z 分位', () => {
    expect(INTERVAL_Z[80]).toBeLessThan(INTERVAL_Z[90]);
    expect(INTERVAL_Z[90]).toBeLessThan(INTERVAL_Z[95]);
  });

  it('runPrediction 支持 80/90/95 区间并正确重算', () => {
    const history = makeSeries(20, (i) => 1000 + i * 50 + ((i % 3) - 1) * 30);
    const r80 = runPrediction(history, 180, 80);
    const r95 = runPrediction(history, 180, 95);
    expect(r80.forecasts.linear.intervalLevel).toBe(80);
    expect(r95.forecasts.linear.intervalLevel).toBe(95);
    const last80 = r80.forecasts.linear.points[r80.forecasts.linear.points.length - 1]!;
    const last95 = r95.forecasts.linear.points[r95.forecasts.linear.points.length - 1]!;
    const width80 = last80.upper95! - last80.lower95!;
    const width95 = last95.upper95! - last95.lower95!;
    expect(width95).toBeGreaterThan(width80);
  });
});
