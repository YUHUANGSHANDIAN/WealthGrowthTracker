import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { totalAssets, leafChannels } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { addDays, todayString } from '../../utils/date';
import { aggregateHistory, type TimeDimension } from '../../utils/timeDimension';
import { Card, EmptyState, Badge } from '../../components/ui/primitives';
import { LineChart } from '../../components/charts/LineChart';
import { BarChart } from '../../components/charts/BarChart';
import { RadarChart } from '../../components/charts/RadarChart';
import { StackedBarChart } from '../../components/charts/StackedBarChart';
import { BRAND, CATEGORICAL_SERIES } from '../../components/charts/palette';
import { analyzeDimensions } from '../prediction/models';
import {
  analyticsKpis,
  assetConcentration,
  channelChange,
  historicalChannelComposition,
  periodComparison,
} from './analytics';

const RANGES = [
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '6M' },
  { value: '365', label: '1Y' },
  { value: '1095', label: '3Y' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: '全部' },
];

const GRANULARITIES: { value: TimeDimension; label: string }[] = [
  { value: 'raw', label: '原始' },
  { value: 'daily', label: '日' },
  { value: 'weekly', label: '周' },
  { value: 'monthly', label: '月' },
  { value: 'quarterly', label: '季' },
  { value: 'yearly', label: '年' },
];

function smooth(points: { date: string; value: number }[], window = 3): { date: string; value: number }[] {
  if (points.length < window) return points;
  return points.map((p, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = points.slice(start, i + 1);
    const v = slice.reduce((a, b) => a + b.value, 0) / slice.length;
    return { date: p.date, value: Math.round(v * 100) / 100 };
  });
}

export function AnalysisPanel() {
  const channels = useAppStore((s) => s.channels);
  const history = useAppStore((s) => s.history);
  const [range, setRange] = useState('90');
  const [granularity, setGranularity] = useState<TimeDimension>('raw');
  const [smoothing, setSmoothing] = useState(false);
  const [changeDays, setChangeDays] = useState(30);

  const today = todayString();
  const total = totalAssets(channels);

  const rangeStart = useMemo(() => {
    if (range === 'all') return null;
    if (range === 'ytd') return `${new Date().getFullYear()}-01-01`;
    return addDays(today, -Number(range));
  }, [range, today]);

  const rangeHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rangeStart) return sorted;
    return sorted.filter((p) => p.date >= rangeStart);
  }, [history, rangeStart]);

  const displayHistory = useMemo(() => aggregateHistory(rangeHistory, granularity), [rangeHistory, granularity]);

  const kpis = useMemo(() => analyticsKpis(history, channels, rangeStart), [history, channels, rangeStart]);

  const trendSeries = useMemo(() => {
    const raw = displayHistory.map((p) => ({ date: p.date, value: p.totalAmount }));
    return [{ id: 'total', name: '总资产', color: BRAND, points: smoothing ? smooth(raw) : raw, area: true }];
  }, [displayHistory, smoothing]);

  const comparisonItems = useMemo(() => {
    return leafChannels(channels)
      .map((l) => {
        const c = channels.find((x) => x.id === l.parentId);
        const color = c?.children?.find((s) => s.id === l.id)?.color ?? c?.color ?? '#2a78d6';
        const emoji = c?.children?.find((s) => s.id === l.id)?.emoji ?? c?.emoji ?? '💰';
        return {
          id: l.id,
          label: l.parentName ? `${l.parentName} · ${l.name}` : l.name,
          value: l.amount,
          color,
          emoji,
          hint: total > 0 ? `${((l.amount / total) * 100).toFixed(1)}%` : '0%',
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [channels, total]);

  const concentration = useMemo(() => assetConcentration(channels), [channels]);
  const comparison = useMemo(() => periodComparison(history), [history]);
  const changes = useMemo(() => channelChange(history, channels, changeDays), [history, channels, changeDays]);
  const composition = useMemo(() => historicalChannelComposition(rangeHistory, 5), [rangeHistory]);

  const radarAxes = useMemo(() => analyzeDimensions(history), [history]);

  return (
    <div className="space-y-4">
      {/* Header 控制 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="时间范围">
            {RANGES.map((r) => (
              <button key={r.value} onClick={() => setRange(r.value)} aria-pressed={range === r.value}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${range === r.value ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {r.label}
              </button>
            ))}
          </div>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as TimeDimension)} className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg" aria-label="时间粒度">
            {GRANULARITIES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} className="h-3.5 w-3.5 text-emerald-600 rounded" />
            平滑显示
          </label>
        </div>
      </Card>

      {/* KPI */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="当前总资产" value={formatCNY(kpis.currentTotal)} />
          <Kpi label="期间起点资产" value={formatCNY(kpis.startTotal)} />
          <Kpi label="期间变化" value={`${kpis.change >= 0 ? '+' : ''}${formatCNY(kpis.change)}`} tone={kpis.change >= 0 ? 'up' : 'down'} />
          <Kpi label="变化率" value={`${kpis.changeRate >= 0 ? '+' : ''}${kpis.changeRate.toFixed(1)}%`} tone={kpis.changeRate >= 0 ? 'up' : 'down'} />
          <Kpi label="期间最高" value={formatCNY(kpis.max)} />
          <Kpi label="期间最低" value={formatCNY(kpis.min)} />
          <Kpi label="期间平均" value={formatCNY(kpis.avg)} />
          <Kpi label="数据覆盖率" value={`${(kpis.coverage * 100).toFixed(0)}%`} />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">「变化率」为资产变化率，不是证券回报率。</p>
      </Card>

      {/* 资产趋势 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">资产趋势</h2>
        {displayHistory.length > 1 ? <LineChart series={trendSeries} ariaLabel="资产趋势图" /> : <EmptyState icon="📈" title="暂无趋势数据" />}
      </Card>

      {/* 历史渠道构成 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-1">历史渠道构成</h2>
        <p className="text-xs text-slate-400 mb-3">渠道资产结构随时间变化（TOP 5 + 其他）。</p>
        {composition.length > 0 ? (
          <StackedBarChart data={composition.map((p) => ({ date: p.date, segments: p.channels.map((c, i) => ({ name: c.name, color: CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length]!, value: c.amount })) }))} ariaLabel="历史渠道构成" />
        ) : (
          <EmptyState icon="🏦" title="历史渠道快照不足" description="旧版历史仅保存总资产，无渠道快照。" />
        )}
      </Card>

      {/* 渠道对比 + 集中度 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-1">渠道对比与资产集中度</h2>
        <p className="text-xs text-slate-400 mb-3">该指标仅描述资产在记录渠道中的集中程度，不代表投资风险。</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Kpi label="TOP 1 占比" value={`${concentration.top1}%`} />
          <Kpi label="TOP 3 占比" value={`${concentration.top3}%`} />
          <Kpi label="HHI" value={String(concentration.hhi)} />
        </div>
        {comparisonItems.length > 0 ? <BarChart items={comparisonItems} ariaLabel="渠道资产对比" /> : <EmptyState icon="🏦" title="暂无渠道数据" />}
      </Card>

      {/* 渠道变化 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">渠道变化分析</h2>
          <select value={String(changeDays)} onChange={(e) => setChangeDays(Number(e.target.value))} className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg" aria-label="变化周期">
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
            <option value="365">近 1 年</option>
          </select>
        </div>
        <div className="space-y-1.5">
          {changes.map((c) => (
            <div key={c.id} className="flex items-center gap-3 text-sm py-1 border-b border-slate-100 last:border-0">
              <span className="w-5 text-center" aria-hidden>{c.emoji}</span>
              <span className="flex-1 truncate text-slate-700">{c.name}</span>
              <span className="tabular text-slate-500">{formatCNY(c.amount)}</span>
              <span className={`tabular font-medium ${(c.change ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {(c.change ?? 0) >= 0 ? '▲+' : '▼'}{formatCNY(Math.abs(c.change ?? 0))}
                {c.changeRate === null ? '（从 0 新增）' : c.changeRate !== null ? ` ${c.changeRate >= 0 ? '+' : ''}${c.changeRate.toFixed(1)}%` : ''}
              </span>
            </div>
          ))}
          {changes.length === 0 && <p className="text-sm text-slate-400">暂无渠道数据。</p>}
        </div>
      </Card>

      {/* 环比同比 */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">周期对比（WoW / MoM / YoY）</h2>
        <div className="grid grid-cols-3 gap-3">
          <PeriodCard label="环比上周" data={comparison.wow} />
          <PeriodCard label="环比上月" data={comparison.mom} />
          <PeriodCard label="同比去年" data={comparison.yoy} />
        </div>
      </Card>

      {/* 雷达 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">财富成长雷达</h2>
          <Badge tone="purple">可解释维度</Badge>
        </div>
        {history.length >= 2 ? (
          <>
            <RadarChart axes={radarAxes.map((a, i) => ({ ...a, color: CATEGORICAL_SERIES[i] ?? BRAND }))} ariaLabel="财富成长雷达图" />
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              {radarAxes.map((a) => (
                <div key={a.dimension}><span className="font-medium">{a.dimension}</span>：{a.description}</div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon="🎯" title="数据不足" description="至少需要两条历史数据才能生成雷达图。" />
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular truncate ${color}`}>{value}</div>
    </div>
  );
}

function PeriodCard({ label, data }: { label: string; data: { change: number; rate: number } | null }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      {data ? (
        <>
          <div className={`text-sm font-semibold tabular ${data.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {data.change >= 0 ? '+' : ''}{formatCNY(data.change)}
          </div>
          <div className={`text-xs tabular ${data.rate >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{data.rate >= 0 ? '+' : ''}{data.rate.toFixed(1)}%</div>
        </>
      ) : (
        <div className="text-sm text-slate-400">暂无数据</div>
      )}
    </div>
  );
}
