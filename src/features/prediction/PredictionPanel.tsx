import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { PredictionModelType } from '../../types';
import { formatCNY, formatAmount } from '../../utils/money';
import { todayString } from '../../utils/date';
import { APP_VERSION } from '../../constants/version';
import { Card, Button, Badge, EmptyState } from '../../components/ui/primitives';
import { LineChart, type LineSeries, type ReferenceLine, type VerticalMarker } from '../../components/charts/LineChart';
import { downloadCSV, downloadPNG, downloadSVG } from '../../components/charts/export';
import { BRAND } from '../../components/charts/palette';
import { PREDICTION_MODELS, HORIZON_OPTIONS, defaultHorizonDays, runPrediction, type Forecast } from './models';
import { DiagnosticsModal } from './DiagnosticsModal';
import { aggregateHistory, filterHistoryRange, filterTrainingWindow } from '../../utils/timeDimension';
import { ChartControls } from './ChartControls';
import { goalRequiredPath, modelDisagreement, type IntervalLevel } from './diagnostics';

export function PredictionPanel() {
  const history = useAppStore((s) => s.history);
  const countdown = useAppStore((s) => s.countdown);
  const chartSettings = useAppStore((s) => s.chartSettings);

  const [horizon, setHorizon] = useState(defaultHorizonDays());
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [selected, setSelected] = useState<PredictionModelType>('hybrid');
  const [intervalLevel, setIntervalLevel] = useState<IntervalLevel>(95);
  const [diagModel, setDiagModel] = useState<PredictionModelType | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const trainingHistory = useMemo(
    () => filterTrainingWindow(history, chartSettings.trainingWindow ?? 'all', chartSettings.customTrainingDays),
    [history, chartSettings.trainingWindow, chartSettings.customTrainingDays],
  );
  const result = useMemo(() => runPrediction(trainingHistory, horizon, intervalLevel), [trainingHistory, horizon, intervalLevel]);
  const sortedHistory = useMemo(
    () => aggregateHistory(filterHistoryRange(history, chartSettings.timeRange ?? 'all', chartSettings.customTimeRangeStart, chartSettings.customTimeRangeEnd), chartSettings.timeDimension ?? 'raw'),
    [history, chartSettings.timeRange, chartSettings.customTimeRangeStart, chartSettings.customTimeRangeEnd, chartSettings.timeDimension],
  );

  const activeForecast: Forecast = selected === 'hybrid' ? result.hybrid : result.forecasts[selected];
  const activeFit = selected === 'hybrid' ? result.hybrid.fit : result.fits[selected];
  const meta = PREDICTION_MODELS.find((m) => m.type === selected)!;

  const goal = useMemo(() => {
    const target = countdown.targetAmount;
    if (!target || target <= 0 || sortedHistory.length === 0) return null;
    const lastValue = sortedHistory[sortedHistory.length - 1]!.totalAmount;
    if (lastValue >= target) return { status: 'done' as const };
    for (const p of activeForecast.points) {
      if (p.value >= target) return { status: 'date' as const, date: p.date };
    }
    return { status: 'unreachable' as const };
  }, [countdown.targetAmount, sortedHistory, activeForecast]);

  const requiredPath = useMemo(() => {
    const target = countdown.targetAmount;
    const targetDate = countdown.targetDateTime?.slice(0, 10) ?? countdown.targetDate;
    if (!target || target <= 0 || sortedHistory.length === 0 || !targetDate) return [];
    const last = sortedHistory[sortedHistory.length - 1]!;
    return goalRequiredPath(last.totalAmount, target, last.date, targetDate);
  }, [countdown.targetAmount, countdown.targetDateTime, countdown.targetDate, sortedHistory]);

  const disagreement = useMemo(() => {
    const forecasts = [result.forecasts.linear, result.forecasts.exponential, result.forecasts.conservative, result.forecasts.aggressive, result.hybrid];
    const dis = modelDisagreement(forecasts);
    return dis.length ? dis[dis.length - 1]!.spread : 0;
  }, [result]);

  // 构建图表序列
  const chart = useMemo(() => {
    const style = chartSettings.chartStyle ?? 'line';
    const historySeries: LineSeries = {
      id: 'history',
      name: '历史资产',
      color: BRAND,
      points: sortedHistory.map((h) => ({ date: h.date, value: h.totalAmount })),
      showDots: style === 'line-dots' || style === 'scatter',
      area: style === 'area',
      strokeWidth: 2,
    };

    const series: LineSeries[] = [];
    if (chartSettings.showHistory !== false) series.push(historySeries);

    if (mode === 'single') {
      const fit = activeFit;
      const lastFitted = fit.fitted.length ? fit.fitted[fit.fitted.length - 1]!.fitted : fit.lastValue;
      const forecastPoints = [
        { date: fit.lastDate, value: lastFitted, lower: lastFitted, upper: lastFitted },
        ...activeForecast.points.map((p) => ({
          date: p.date,
          value: p.value,
          lower: p.lower95 ?? p.value,
          upper: p.upper95 ?? p.value,
        })),
      ];
      if (chartSettings.showFitted !== false) {
        series.push({
          id: 'fitted',
          name: `${meta.shortName}拟合`,
          color: meta.color,
          points: fit.fitted.map((f) => ({ date: f.date, value: f.fitted })),
          strokeWidth: 1.2,
        });
      }
      if (chartSettings.showForecast !== false) {
        series.push({
          id: 'forecast',
          name: `${meta.shortName}预测`,
          color: meta.color,
          points: forecastPoints,
          dashed: true,
          band: chartSettings.showPredictionBand !== false && activeForecast.intervalType !== 'none',
          bandColor: meta.color,
          strokeWidth: 2,
        });
      }
      if (requiredPath.length > 1) {
        series.push({
          id: 'required',
          name: '目标所需轨迹',
          color: '#e34948',
          points: requiredPath.map((p) => ({ date: p.date, value: p.value })),
          dashed: true,
          strokeWidth: 1.5,
        });
      }
      return series;
    }

    for (const m of PREDICTION_MODELS) {
      const f = m.type === 'hybrid' ? result.hybrid : result.forecasts[m.type];
      const pts = [
        { date: f.fit.lastDate, value: f.fit.lastValue },
        ...f.points.map((p) => ({ date: p.date, value: p.value })),
      ];
      series.push({ id: m.type, name: m.shortName, color: m.color, points: pts, dashed: true, strokeWidth: 2 });
    }
    return series;
  }, [mode, sortedHistory, activeFit, activeForecast, meta, result, chartSettings, requiredPath]);

  const referenceLines: ReferenceLine[] =
    countdown.targetAmount > 0 && chartSettings.showTarget !== false
      ? [{ value: countdown.targetAmount, label: `目标 ${formatCNY(countdown.targetAmount)}`, color: '#e34948' }]
      : [];

  const verticalMarkers: VerticalMarker[] = sortedHistory.length
    ? [{ date: sortedHistory[sortedHistory.length - 1]!.date, label: '预测起点', color: '#898781' }]
    : [];

  function onExport(format: 'png' | 'svg' | 'csv') {
    const el = chartRef.current;
    if (!el) return;
    const svg = el.querySelector('svg');
    const base = `wealth-forecast_${selected}_${todayString()}`;
    if (format === 'svg' && svg) downloadSVG(svg, `${base}.svg`);
    else if (format === 'png' && svg) void downloadPNG(svg, `${base}.png`);
    else if (format === 'csv') {
      const header = ['date', 'historical', 'fitted', 'forecast', 'lower', 'upper', 'model'];
      const rows: (string | number)[][] = [];
      for (const h of sortedHistory) rows.push([h.date, h.totalAmount, '', '', '', '', selected]);
      for (const f of activeForecast.points) rows.push([f.date, '', '', f.value, f.lower95 ?? '', f.upper95 ?? '', selected]);
      const meta: [string, string][] = [
        ['model', selected],
        ['trainingWindow', chartSettings.trainingWindow ?? 'all'],
        ['displayRange', chartSettings.timeRange ?? 'all'],
        ['horizon', String(horizon)],
        ['intervalLevel', String(intervalLevel)],
        ['generatedAt', new Date().toISOString()],
        ['appVersion', APP_VERSION],
      ];
      downloadCSV(`${base}.csv`, header, rows, meta);
    }
  }

  if (sortedHistory.length === 0) {
    return (
      <Card>
        <EmptyState icon="🔮" title="暂无历史数据" description="至少需要一条历史记录才能生成预测。请在「历史」页添加数据。" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 智能推荐 */}
      <Card className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">智能模型推荐</h2>
            <p className="text-xs text-slate-500">基于本地历史数据与滚动回测结果，不联网、不上传数据</p>
          </div>
          <Badge tone={result.recommendation.sufficient ? 'purple' : 'amber'}>
            推荐：{PREDICTION_MODELS.find((m) => m.type === result.recommendation.model)?.name}
          </Badge>
        </div>
        <ul className="text-sm text-slate-600 space-y-1 mt-2">
          {result.recommendation.reasons.map((r, i) => (
            <li key={i}>· {r}</li>
          ))}
        </ul>
        <div className="text-xs text-slate-500 border-t border-purple-100 pt-2 mt-2">
          {result.recommendation.notes.map((n, i) => (
            <p key={i}>💡 {n}</p>
          ))}
        </div>
      </Card>

      {/* 数据质量 */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h2 className="font-semibold text-slate-800">数据质量</h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          <QStat label="历史数据点" value={String(result.dataQuality.pointCount)} />
          <QStat label="时间跨度" value={`${result.dataQuality.spanDays}天`} />
          <QStat label="平均间隔" value={`${result.dataQuality.avgIntervalDays}天`} />
          <QStat label="最大缺口" value={`${result.dataQuality.maxGapDays}天`} />
          <QStat label="有效正数点" value={String(result.dataQuality.positiveCount)} />
          <QStat label="异常跳变" value={`${result.dataQuality.anomalies.length}个`} />
        </div>
        {result.dataQuality.anomalies.length > 0 && (
          <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            ⚠️ 检测到 {result.dataQuality.anomalies.length} 个疑似异常跳变点（如大额转账或录入错误），建议人工确认。
            异常点仅提示，不会被自动删除。
          </div>
        )}
      </Card>

      {/* 控件 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {HORIZON_OPTIONS.map((h) => (
            <button
              key={h.days}
              onClick={() => setHorizon(h.days)}
              aria-pressed={horizon === h.days}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                horizon === h.days ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto" role="group" aria-label="预测区间">
          {([80, 90, 95] as IntervalLevel[]).map((l) => (
            <button
              key={l}
              onClick={() => setIntervalLevel(l)}
              aria-pressed={intervalLevel === l}
              className={`px-2 py-1 text-xs rounded-lg ${intervalLevel === l ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {l}%
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setMode('single')}
            aria-pressed={mode === 'single'}
            className={`px-2.5 py-1 text-xs rounded-lg ${mode === 'single' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            单模型
          </button>
          <button
            onClick={() => setMode('compare')}
            aria-pressed={mode === 'compare'}
            className={`px-2.5 py-1 text-xs rounded-lg ${mode === 'compare' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            比较模型
          </button>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onExport('svg')}>SVG</Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('png')}>PNG</Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('csv')}>CSV</Button>
        </div>
      </div>

      <ChartControls />

      {/* 模型选择（单模型模式） */}
      {mode === 'single' && (
        <div className="flex flex-wrap gap-2">
          {PREDICTION_MODELS.map((m) => (
            <button
              key={m.type}
              onClick={() => setSelected(m.type)}
              aria-pressed={selected === m.type}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                selected === m.type ? 'bg-white border-slate-400 text-slate-800' : 'border-slate-200 bg-white text-slate-500'
              }`}
              style={selected === m.type ? { boxShadow: `inset 0 0 0 2px ${m.color}` } : undefined}
            >
              <span aria-hidden>{m.icon}</span> {m.name}
            </button>
          ))}
        </div>
      )}

      {/* 主图 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-800">
            {mode === 'compare' ? '模型比较' : `${meta.name} · ${result.dataQuality.spanDays} 天历史`}
          </h2>
          <Button size="sm" variant="outline" onClick={() => setDiagModel(selected)}>
            查看模型详情
          </Button>
        </div>
        <div ref={chartRef}>
          <LineChart series={chart} referenceLines={referenceLines} verticalMarkers={verticalMarkers} ariaLabel="财富预测图" />
        </div>
        {activeForecast.intervalType === 'none' && activeForecast.intervalNote && (
          <p className="text-xs text-slate-400 mt-2">{activeForecast.intervalNote}</p>
        )}
        {mode === 'single' && activeForecast.intervalType !== 'none' && (
          <p className="text-xs text-slate-400 mt-2">阴影带为 {intervalLevel}% 预测区间（{activeForecast.intervalType === 'analytic' ? '解析' : '残差 bootstrap'}法）。</p>
        )}
      </Card>

      {/* 目标到达 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">目标金额预测</h2>
        {goal ? (
          goal.status === 'done' ? (
            <p className="text-sm text-emerald-600">🎉 当前总资产已达到目标 {formatCNY(countdown.targetAmount)}。</p>
          ) : goal.status === 'date' ? (
            <p className="text-sm text-slate-600">
              在「{meta.name}」中心外推轨迹下，预计在 <span className="font-semibold tabular">{goal.date}</span> 达到目标{' '}
              {formatCNY(countdown.targetAmount)}。<span className="text-xs text-slate-400">（非保证，仅数学外推）</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              当前预测区间内尚未达到目标 {formatCNY(countdown.targetAmount)}（预测跨度 {horizon} 天）。
            </p>
          )
        ) : (
          <p className="text-sm text-slate-400">未设置目标金额。</p>
        )}
      </Card>

      {/* 模型指标表（比较模式） */}
      {mode === 'compare' && (
        <Card className="p-4 overflow-x-auto">
          <h2 className="font-semibold text-slate-800 mb-2">模型指标</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-2 font-medium">模型</th>
                <th className="py-2 px-2 font-medium">RMSE</th>
                <th className="py-2 px-2 font-medium">sMAPE</th>
                <th className="py-2 px-2 font-medium">回测窗口</th>
                <th className="py-2 px-2 font-medium">预测终值</th>
              </tr>
            </thead>
            <tbody>
              {result.backtests.map((bt) => {
                const f = result.forecasts[bt.model];
                return (
                  <tr key={bt.model} className="border-b border-slate-50">
                    <td className="py-2 pr-2">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: PREDICTION_MODELS.find((m) => m.type === bt.model)!.color }} aria-hidden />
                      {PREDICTION_MODELS.find((m) => m.type === bt.model)!.name}
                    </td>
                    <td className="py-2 px-2 tabular">{bt.insufficient ? '—' : formatAmount(bt.rmse)}</td>
                    <td className="py-2 px-2 tabular">{bt.insufficient ? '—' : `${bt.smape.toFixed(1)}%`}</td>
                    <td className="py-2 px-2 tabular">{bt.insufficient ? '不足' : bt.windows}</td>
                    <td className="py-2 px-2 tabular">{formatCNY(f.points[f.points.length - 1]?.value ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.weights.source === 'backtest' && (
            <p className="text-xs text-slate-500 mt-2">
              混合模型动态权重：线性 {(result.weights.linear * 100).toFixed(0)}% · 指数 {(result.weights.exponential * 100).toFixed(0)}% · 保守 {(result.weights.conservative * 100).toFixed(0)}% · 积极 {(result.weights.aggressive * 100).toFixed(0)}%
            </p>
          )}
          <p className="text-xs text-slate-400 mt-2">
            模型分歧（同一预测日期五种模型最高值 − 最低值）：<span className="tabular font-medium">{formatCNY(disagreement)}</span>。分歧越大表示模型不确定性越高（非风险概率）。
          </p>
        </Card>
      )}

      {/* 免责声明 */}
      <p className="text-xs text-slate-400 px-1">
        ⚠️ 预测结果仅基于历史总资产轨迹的数学外推，资产变化可能来自工资、储蓄、转账等，不代表投资收益保证。
      </p>

      {diagModel && (
        <DiagnosticsModal
          fit={diagModel === 'hybrid' ? result.hybrid.fit : result.fits[diagModel]}
          backtest={result.backtests.find((b) => b.model === diagModel)}
          horizonDays={horizon}
          onClose={() => setDiagModel(null)}
        />
      )}
    </div>
  );
}

function QStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg py-2 px-1">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-700 tabular">{value}</div>
    </div>
  );
}
