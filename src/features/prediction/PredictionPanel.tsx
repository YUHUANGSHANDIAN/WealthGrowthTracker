import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { PredictionModelType } from '../../types';
import { Card, Button, Badge, EmptyState, Spinner } from '../../components/ui/primitives';
import { LineChart, type LineSeries } from '../../components/charts/LineChart';
import { BRAND } from '../../components/charts/palette';
import {
  PREDICTION_MODELS,
  computeStats,
  recommendModel,
  predictWithModel,
  predictHybrid,
  defaultHorizonDays,
} from './models';

export function PredictionPanel() {
  const history = useAppStore((s) => s.history);
  const channels = useAppStore((s) => s.channels);
  const countdown = useAppStore((s) => s.countdown);

  const [model, setModel] = useState<PredictionModelType>('linear');
  const [aiResult, setAiResult] = useState<{ rec: ReturnType<typeof recommendModel> } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const sorted = useMemo(() => [...history].sort((a, b) => (a.date < b.date ? -1 : 1)), [history]);
  const total = useMemo(() => channels.reduce((a, c) => a + (c.amount || 0), 0), [channels]);
  const goalProgress = countdown.targetAmount > 0 ? Math.min(1, total / countdown.targetAmount) : 0;
  const stats = useMemo(() => computeStats(sorted), [sorted]);

  function runLocalAnalysis() {
    setAnalyzing(true);
    // 本地规则分析：模拟短暂计算过程以提供反馈（纯本地，无网络请求）。
    setTimeout(() => {
      const rec = recommendModel(sorted, goalProgress);
      setAiResult({ rec });
      setAnalyzing(false);
    }, 400);
  }

  const predictionSeries = useMemo<LineSeries[]>(() => {
    if (sorted.length === 0) return [];
    const last = sorted[sorted.length - 1]!;
    const horizon = defaultHorizonDays();
    const pred =
      model === 'hybrid'
        ? predictHybrid(sorted, horizon)
        : predictWithModel(sorted, model, horizon);
    const predPoints = [{ date: last.date, value: last.totalAmount }, ...pred.map((p) => ({ date: p.date, value: p.totalAmount }))];
    const modelColor = PREDICTION_MODELS.find((m) => m.type === model)?.color ?? BRAND;
    return [
      { id: 'history', name: '历史资产', color: BRAND, points: sorted.map((p) => ({ date: p.date, value: p.totalAmount })) },
      { id: 'prediction', name: '预测走势', color: modelColor, points: predPoints, dashed: true },
    ];
  }, [sorted, model]);

  const meta = PREDICTION_MODELS.find((m) => m.type === model)!;
  const trendLabel = stats.trend === 'increasing' ? '上升' : stats.trend === 'decreasing' ? '下降' : '平稳';

  return (
    <div className="space-y-4">
      {/* 本地 AI 分析 */}
      <Card className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-slate-800">AI 智能推荐</h2>
            <p className="text-xs text-slate-500">基于历史数据的本地规则分析（不联网、不上传数据）</p>
          </div>
          <Button variant="secondary" onClick={runLocalAnalysis} disabled={analyzing || sorted.length < 3}>
            {analyzing ? <Spinner className="h-3.5 w-3.5 mr-1" /> : <span aria-hidden>✨</span>}
            {analyzing ? '分析中…' : '开始分析'}
          </Button>
        </div>

        {sorted.length < 3 && (
          <p className="text-xs text-amber-600 mt-2">至少需要 3 条历史数据才能进行智能分析。</p>
        )}

        {aiResult && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="purple">推荐模型：{PREDICTION_MODELS.find((m) => m.type === aiResult.rec.model)?.name}</Badge>
              <Badge tone={aiResult.rec.risk.level === 'low' ? 'emerald' : aiResult.rec.risk.level === 'high' ? 'red' : 'amber'}>
                {aiResult.rec.risk.label}
              </Badge>
            </div>
            <ul className="text-sm text-slate-600 space-y-1">
              {aiResult.rec.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
            <div className="text-xs text-slate-500 border-t border-purple-100 pt-2">
              <div className="font-medium text-slate-600 mb-1">建议</div>
              <ul className="space-y-1">
                {aiResult.rec.advice.map((a, i) => (
                  <li key={i}>💡 {a}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>

      {/* 统计摘要 */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="波动率" value={`${(stats.volatility * 100).toFixed(1)}%`} />
          <Stat label="趋势" value={trendLabel} />
          <Stat label="置信度" value={`${(stats.confidence * 100).toFixed(0)}%`} />
        </div>
      </Card>

      {/* 模型选择 */}
      <div className="flex flex-wrap gap-2">
        {PREDICTION_MODELS.map((m) => (
          <button
            key={m.type}
            onClick={() => setModel(m.type)}
            aria-pressed={model === m.type}
            className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
              model === m.type
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
            style={model === m.type ? { borderColor: m.color } : undefined}
          >
            <span aria-hidden>{m.icon}</span> {m.name}
          </button>
        ))}
      </div>

      {/* 预测图表 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-1">{meta.name}预测</h2>
        <p className="text-xs text-slate-500 mb-3">{meta.description} · {meta.suitable}</p>
        {predictionSeries.length > 0 ? (
          <LineChart series={predictionSeries} ariaLabel={`${meta.name}预测图`} />
        ) : (
          <EmptyState icon="🔮" title="暂无数据" description="需要至少一条历史数据才能生成预测。" />
        )}
        <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-2">
          ⚠️ 预测结果仅基于历史数据的数学外推，不代表投资收益保证。
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800 tabular">{value}</div>
    </div>
  );
}
