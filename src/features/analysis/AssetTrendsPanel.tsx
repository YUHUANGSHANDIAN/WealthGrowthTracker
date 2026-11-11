import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { AssetTrendChart } from '../../components/charts/AssetTrendChart';
import { StackedBarChart } from '../../components/charts/StackedBarChart';
import { CATEGORICAL_SERIES, BRAND } from '../../components/charts/palette';
import { useAppStore } from '../../store/appStore';
import { useNavigationStore } from '../../store/navigationStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { formatCNY } from '../../utils/money';
import { addDays, todayString, yearStart } from '../../utils/date';
import {
  buildAssetTrend,
  buildChangeExplanation,
  buildChannelComposition,
  compareHistoryObservations,
  downsamplePreservingExtremes,
  type AssetTrendPoint,
  type ClassificationLabelMode,
  type TrendBaselineMode,
  type TrendGranularity,
} from '../../domain/analysis/assetTrends';
import { projectMonthlyPlanningClassification } from '../../domain/assets/classification';
import { SavedViewBar } from '../../components/ui/workspace';
import { CHANNEL_TERMS } from '../../constants/channelTerms';

const RANGES = [
  { value: '30', label: '30天' },
  { value: '90', label: '90天' },
  { value: '180', label: '6个月' },
  { value: '365', label: '1年' },
  { value: 'ytd', label: '年初至今' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
] as const;

type RangePreset = typeof RANGES[number]['value'];
type View = 'total' | 'composition' | 'changes';

function colorFor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return CATEGORICAL_SERIES[hash % CATEGORICAL_SERIES.length]!;
}

function rollingMean(points: readonly AssetTrendPoint[], window = 3): Array<{ date: string; value: number | null }> {
  const values: number[] = [];
  return points.map((point) => {
    if (point.value === null) {
      values.length = 0;
      return { date: point.observedAt ?? point.bucketStart, value: null };
    }
    values.push(point.value);
    while (values.length > window) values.shift();
    return {
      date: point.observedAt ?? point.bucketStart,
      value: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100,
    };
  });
}

function pointDelta(points: readonly AssetTrendPoint[], date: string): number | null {
  const index = points.findIndex((point) => (point.observedAt ?? point.bucketStart) === date);
  if (index <= 0) return null;
  const current = points[index]?.value;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = points[cursor]?.value;
    if (previous !== null && previous !== undefined && current !== null && current !== undefined) {
      return Math.round((current - previous) * 100) / 100;
    }
  }
  return null;
}

export function AssetTrendsPanel() {
  const history = useAppStore((state) => state.history);
  const channels = useAppStore((state) => state.channels);
  const reports = useAppStore((state) => state.reports);
  const rawPlanning = useAppStore((state) => state.monthlyPlanning);
  const classifications = useAppStore((state) => state.assetClassification);
  const navigate = useNavigationStore((state) => state.navigate);
  const routeStart = useNavigationStore((state) => state.startDate);
  const routeEnd = useNavigationStore((state) => state.endDate);
  const routeCompareFrom = useNavigationStore((state) => state.trendCompareFrom ?? '');
  const routeCompareTo = useNavigationStore((state) => state.trendCompareTo ?? '');
  const amountsHidden = useWorkspaceStore((state) => state.amountsHidden);
  const [preset, setPreset] = useState<RangePreset>('90');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [granularity, setGranularity] = useState<TrendGranularity>('raw');
  const [baselineMode, setBaselineMode] = useState<TrendBaselineMode>('in-range');
  const [includeLive, setIncludeLive] = useState(false);
  const [showMean, setShowMean] = useState(false);
  const [view, setView] = useState<View>('total');
  const [level, setLevel] = useState<'parent' | 'leaf'>('parent');
  const [parentChannelId, setParentChannelId] = useState('');
  const [labelMode, setLabelMode] = useState<ClassificationLabelMode>('as-recorded');
  const [compositionMode, setCompositionMode] = useState<'absolute' | 'percent'>('absolute');
  const [topN, setTopN] = useState(5);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = todayString();
  const endDate = routeEnd ?? (preset === 'custom' && customEnd ? customEnd : today);
  const startDate = useMemo(() => {
    if (routeStart) return routeStart;
    if (preset === 'custom') return customStart || null;
    if (preset === 'all') return [...history].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
    if (preset === 'ytd') return yearStart(today);
    return addDays(today, -Number(preset));
  }, [customStart, history, preset, routeStart, today]);
  const invalidRange = Boolean(startDate && startDate > endDate);

  const trend = useMemo(() => {
    if (invalidRange) return null;
    return buildAssetTrend({
      history,
      channels,
      startDate,
      endDate,
      granularity,
      baselineMode,
      includeLive,
      today,
    });
  }, [baselineMode, channels, endDate, granularity, history, includeLive, invalidRange, startDate, today]);

  const projectedPlanning = useMemo(
    () => projectMonthlyPlanningClassification(rawPlanning, classifications),
    [rawPlanning, classifications],
  );

  const composition = useMemo(() => {
    if (invalidRange) return null;
    return buildChannelComposition({
      history,
      classifications,
      startDate,
      endDate,
      level,
      parentChannelId: level === 'leaf' ? parentChannelId || null : null,
      topN,
      mode: compositionMode,
      labelMode,
    });
  }, [classifications, compositionMode, endDate, history, invalidRange, labelMode, level, parentChannelId, startDate, topN]);

  const explanation = useMemo(() => {
    if (invalidRange) return null;
    return buildChangeExplanation({
      history,
      classifications,
      reports,
      planning: projectedPlanning,
      startDate,
      endDate,
    });
  }, [classifications, endDate, history, invalidRange, projectedPlanning, reports, startDate]);

  const money = (value: number | null) => value === null ? '未知' : amountsHidden ? '••••' : formatCNY(value);
  const percent = (value: number | null) => value === null ? '不可计算' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const trendPoints = trend?.points ?? [];
  const chartPoints = downsamplePreservingExtremes(trendPoints);
  const meanPoints = showMean ? rollingMean(trendPoints) : [];
  const livePoints = trend?.kpis.liveValue !== null && trend?.kpis.liveDate
    ? [{ date: trend.kpis.liveDate, value: trend.kpis.liveValue }]
    : [];
  const displaySeries = [
    { id: 'total', name: '总资产', color: BRAND, area: true, points: chartPoints.map((point) => ({ date: point.observedAt ?? point.bucketStart, value: point.value })) },
    ...(showMean ? [{ id: 'mean', name: '3 点参考均值', color: '#7c3aed', dashed: true, points: meanPoints }] : []),
    ...(livePoints.length ? [{ id: 'live', name: '实时（未入历史）', color: '#f59e0b', dashed: true, points: livePoints }] : []),
  ];
  const detailedSeries = [
    { id: 'total', name: '总资产', color: BRAND, area: true, points: trendPoints.map((point) => ({ date: point.observedAt ?? point.bucketStart, value: point.value })) },
    ...(showMean ? [{ id: 'mean', name: '3 点参考均值', color: '#7c3aed', dashed: true, points: meanPoints }] : []),
    ...(livePoints.length ? [{ id: 'live', name: '实时（未入历史）', color: '#f59e0b', dashed: true, points: livePoints }] : []),
  ];
  const selectedRaw = selectedDate ? history.find((point) => point.date === selectedDate) : undefined;
  const selectedDelta = selectedDate ? pointDelta(trendPoints, selectedDate) : null;
  const observationDates = useMemo(
    () => [...history]
      .filter((point) => point.date <= today && (!startDate || point.date >= startDate) && point.date <= endDate)
      .map((point) => point.date)
      .sort((a, b) => a.localeCompare(b)),
    [endDate, history, startDate, today],
  );
  const observationComparison = useMemo(() => {
    if (!routeCompareFrom || !routeCompareTo) return null;
    try {
      return { value: compareHistoryObservations(history, routeCompareFrom, routeCompareTo), error: null };
    } catch (cause) {
      return { value: null, error: cause instanceof Error ? cause.message : '无法比较观察点' };
    }
  }, [history, routeCompareFrom, routeCompareTo]);
  const markers = [
    ...classifications.events.map((event) => ({
      date: event.classifiedAt.slice(0, 10),
      label: event.kind === 'holding-reclassify' ? '分类调整' : event.kind === 'channel-rename' ? '渠道更名' : '分类事件',
      color: event.kind === 'channel-rename' ? '#7c3aed' : '#d97706',
    })),
    ...(routeCompareFrom ? [{ date: routeCompareFrom, label: '比较起点', color: '#157f52' }] : []),
    ...(routeCompareTo ? [{ date: routeCompareTo, label: '比较终点', color: '#157f52' }] : []),
  ]
    .filter((marker) => (!startDate || marker.date >= startDate) && marker.date <= endDate);
  const parents = channels.filter((channel) => channel.children?.length);

  return (
    <div className="asset-trends space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-800">资产历史趋势</h2>
              <Badge tone="blue">{trend?.kpis.observedDays ?? 0} 个记录日</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">真实日期、真实观察点与可审计分类事件；余额变化不等于投资收益。</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>历史截止：{trend?.kpis.endDate ?? '无记录'}</div>
            <div>当前实时余额：{trend?.kpis.liveValue === null ? '未叠加' : `${money(trend?.kpis.liveValue ?? null)} · ${trend?.kpis.liveDate ?? today}`}</div>
          </div>
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div className="asset-trends-controls">
          <div className="flex flex-wrap gap-1" role="group" aria-label="时间范围">
            {RANGES.map((item) => (
              <button key={item.value} type="button" className="trend-segment" aria-pressed={preset === item.value} onClick={() => { setPreset(item.value); navigate({ tab: 'analysis' }); }}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="trend-field">粒度
            <select value={granularity} onChange={(event) => setGranularity(event.target.value as TrendGranularity)}>
              <option value="raw">原始</option>
              <option value="weekly">周末值（ISO）</option>
              <option value="monthly">月末值</option>
            </select>
          </label>
          <label className="trend-field">基线
            <select value={baselineMode} onChange={(event) => setBaselineMode(event.target.value as TrendBaselineMode)}>
              <option value="in-range">区间内首个记录</option>
              <option value="previous">区间前最近记录</option>
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="trend-field">开始<input type="date" value={customStart || routeStart || ''} max={endDate} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label className="trend-field">结束<input type="date" value={customEnd || routeEnd || ''} max={today} onChange={(event) => setCustomEnd(event.target.value)} /></label>
            </>
          )}
          <label className="trend-check"><input type="checkbox" checked={includeLive} onChange={(event) => setIncludeLive(event.target.checked)} />叠加实时值</label>
          <label className="trend-check"><input type="checkbox" checked={showMean} onChange={(event) => setShowMean(event.target.checked)} />参考均线</label>
        </div>
        {invalidRange && <p role="alert" className="mt-3 text-sm text-red-600">起始日期不能晚于结束日期。</p>}
      </Card>

      <SavedViewBar
        page="analysis"
        tab="analysis"
        filters={{
          view,
          level,
          compositionMode,
          topN,
          labelMode,
          startDate: startDate ?? '',
          endDate,
          compareFrom: routeCompareFrom,
          compareTo: routeCompareTo,
        }}
        onApply={(filters) => {
          if (filters.view === 'total' || filters.view === 'composition' || filters.view === 'changes') setView(filters.view);
          if (filters.level === 'parent' || filters.level === 'leaf') setLevel(filters.level);
          if (filters.compositionMode === 'absolute' || filters.compositionMode === 'percent') setCompositionMode(filters.compositionMode);
          if (typeof filters.topN === 'number') setTopN(filters.topN);
          if (filters.labelMode === 'as-recorded' || filters.labelMode === 'current') setLabelMode(filters.labelMode);
        }}
        routeForFilters={(filters) => ({
          startDate: typeof filters.startDate === 'string' && filters.startDate ? filters.startDate : undefined,
          endDate: typeof filters.endDate === 'string' && filters.endDate ? filters.endDate : undefined,
          trendCompareFrom: typeof filters.compareFrom === 'string' && filters.compareFrom ? filters.compareFrom : undefined,
          trendCompareTo: typeof filters.compareTo === 'string' && filters.compareTo ? filters.compareTo : undefined,
        })}
      />

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="资产趋势视图">
        {([
          ['total', '总资产轨迹'],
          ['composition', '渠道结构'],
          ['changes', '变动解读'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="trend-view-tab" onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">两个真实观察点比较</h3>
            <p className="mt-1 text-xs text-slate-500">只比较实际存在的历史快照；不补点、不把余额变化解释为投资收益。</p>
          </div>
          {(routeCompareFrom || routeCompareTo) && (
            <Button size="sm" variant="ghost" onClick={() => navigate({ tab: 'analysis', startDate: routeStart, endDate: routeEnd })}>清除比较</Button>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="trend-field">较早观察点
            <select
              value={routeCompareFrom}
              onChange={(event) => navigate({
                tab: 'analysis',
                startDate: routeStart,
                endDate: routeEnd,
                trendCompareFrom: event.target.value || undefined,
                trendCompareTo: routeCompareTo || undefined,
              })}
            >
              <option value="">选择真实日期</option>
              {observationDates.map((date) => <option key={date} value={date}>{date}</option>)}
            </select>
          </label>
          <label className="trend-field">较晚观察点
            <select
              value={routeCompareTo}
              onChange={(event) => navigate({
                tab: 'analysis',
                startDate: routeStart,
                endDate: routeEnd,
                trendCompareFrom: routeCompareFrom || undefined,
                trendCompareTo: event.target.value || undefined,
              })}
            >
              <option value="">选择真实日期</option>
              {observationDates.map((date) => <option key={date} value={date}>{date}</option>)}
            </select>
          </label>
        </div>
        {observationComparison?.error && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{observationComparison.error}</p>}
        {observationComparison?.value && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="较早观察" value={money(observationComparison.value.fromValue)} detail={observationComparison.value.fromDate} />
              <Kpi label="较晚观察" value={money(observationComparison.value.toValue)} detail={observationComparison.value.toDate} />
              <Kpi label="资产变化" value={money(observationComparison.value.change)} detail="后减前" tone={observationComparison.value.change >= 0 ? 'up' : 'down'} />
              <Kpi label="变化率" value={percent(observationComparison.value.changeRate)} detail="不是投资回报率" tone={(observationComparison.value.changeRate ?? 0) >= 0 ? 'up' : 'down'} />
            </div>
            {observationComparison.value.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {observationComparison.value.warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <caption className="sr-only">两个真实历史观察点的渠道差异；缺少任一侧快照的渠道标为不可比较。</caption>
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                  <th scope="col" className="px-3 py-2 font-medium">渠道</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{observationComparison.value.fromDate}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{observationComparison.value.toDate}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">差异</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {observationComparison.value.channels.map((channel) => (
                    <tr key={channel.id}>
                      <th scope="row" className="px-3 py-2 text-left font-normal text-slate-700">{channel.name}</th>
                      <td className="px-3 py-2 text-right tabular text-slate-600">{channel.from === null ? '无快照' : money(channel.from)}</td>
                      <td className="px-3 py-2 text-right tabular text-slate-600">{channel.to === null ? '无快照' : money(channel.to)}</td>
                      <td className="px-3 py-2 text-right tabular text-slate-700">{channel.comparable ? money(channel.change) : '不可比较'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {view === 'total' && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="实际起点资产" value={money(trend?.kpis.startValue ?? null)} detail={trend?.kpis.startDate ?? '无记录'} />
            <Kpi label="实际终点资产" value={money(trend?.kpis.endValue ?? null)} detail={trend?.kpis.endDate ?? '无记录'} />
            <Kpi label="资产变化" value={money(trend?.kpis.change ?? null)} detail="终点减起点" tone={(trend?.kpis.change ?? 0) >= 0 ? 'up' : 'down'} />
            <Kpi label="资产变化率" value={percent(trend?.kpis.changeRate ?? null)} detail="不是投资回报率" tone={(trend?.kpis.changeRate ?? 0) >= 0 ? 'up' : 'down'} />
          </div>
          <Card className="p-4">
            {!invalidRange && chartPoints.length > 0 ? (
              <AssetTrendChart
                series={displaySeries}
                tableSeries={detailedSeries}
                markers={markers}
                valueFormatter={(value) => amountValue(value, amountsHidden)}
                ariaLabel="总资产历史趋势图"
                onSelectedDateChange={setSelectedDate}
              />
            ) : <EmptyState icon="📈" title="暂无可绘制数据" description="调整日期范围或先建立历史记录。" />}
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
              <span>覆盖：{((trend?.kpis.coverage ?? 0) * 100).toFixed(1)}%（{trend?.kpis.observedDays ?? 0}/{trend?.kpis.calendarDays ?? 0} 天）</span>
              <span>最高：{money(trend?.kpis.max ?? null)}</span>
              <span>最低：{money(trend?.kpis.min ?? null)}</span>
              <span>记录均值：{money(trend?.kpis.mean ?? null)}</span>
              {trend?.kpis.baselineOutsideRange && <span>起点采用区间外最近记录</span>}
            </div>
            {selectedDate && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{selectedDate} · {selectedRaw ? '真实历史快照' : '图表缺口标记'}</span>
                  <Button size="sm" variant="outline" onClick={() => navigate({ tab: 'history', historyDate: selectedDate })}>打开历史记录</Button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedRaw ? `${historySourceText(selectedRaw.source)} · 相对上一真实记录 ${money(selectedDelta)}` : '该日期没有有效历史快照，不能推算当日余额。'}
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {view === 'composition' && composition && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="trend-field">层级
              <select value={level} onChange={(event) => setLevel(event.target.value as 'parent' | 'leaf')}>
                <option value="parent">父渠道</option>
                <option value="leaf">{CHANNEL_TERMS.detailLevel}</option>
              </select>
            </label>
            {level === 'leaf' && (
              <label className="trend-field">父渠道
                <select value={parentChannelId} onChange={(event) => setParentChannelId(event.target.value)}>
                  <option value="">全部渠道</option>
                  {parents.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
              </label>
            )}
            <label className="trend-field">单位
              <select value={compositionMode} onChange={(event) => setCompositionMode(event.target.value as 'absolute' | 'percent')}>
                <option value="absolute">金额</option>
                <option value="percent">100% 占比</option>
              </select>
            </label>
            <label className="trend-field">Top N
              <select value={String(topN)} onChange={(event) => setTopN(Number(event.target.value))}>
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="99">全部</option>
              </select>
            </label>
            <label className="trend-field">名称
              <select value={labelMode} onChange={(event) => setLabelMode(event.target.value as ClassificationLabelMode)}>
                <option value="as-recorded">当时记录</option>
                <option value="current">当前分类名称</option>
              </select>
            </label>
          </div>
          {composition.points.some((point) => !point.missing) ? (
            <>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {composition.series.map((series) => (
                  <span key={series.id} className="inline-flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(series.id) }} />
                    {labelMode === 'current' ? series.currentName : series.recordedNames[series.recordedNames.length - 1] ?? series.currentName}
                    {series.recordedNames.length > 1 && <span className="text-slate-400">（历史名称有变化）</span>}
                  </span>
                ))}
              </div>
              <StackedBarChart
                data={composition.points.map((point) => ({
                  date: point.date,
                  missing: point.missing,
                  segments: point.segments
                    .filter((segment): segment is typeof segment & { value: number } => segment.value !== null)
                    .map((segment) => ({
                      id: segment.id,
                      name: labelMode === 'current' ? segment.currentName : segment.recordedName,
                      color: colorFor(segment.id),
                      value: segment.value,
                    })),
                }))}
                valueFormatter={compositionMode === 'percent'
                  ? (value) => `${value.toFixed(1)}%`
                  : (value) => amountValue(value, amountsHidden)}
                ariaLabel="渠道结构演变"
              />
            </>
          ) : <EmptyState icon="🏦" title="渠道快照不足" description="所选区间没有可用的渠道构成记录。" />}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">缺快照不补零；{CHANNEL_TERMS.parentRollup}与{CHANNEL_TERMS.subchannel}明细分开显示，{CHANNEL_TERMS.noDoubleCount}。无历史持仓证据的 A/C 分类搬移不会回填历史金额。</p>
        </Card>
      )}

      {view === 'changes' && explanation && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800">期间变动</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="期初" value={money(explanation.channels.reduce((sum, item) => sum + (item.start ?? 0), 0))} detail={explanation.startDate ?? '未知'} />
              <Kpi label="期末" value={money(explanation.channels.reduce((sum, item) => sum + (item.end ?? 0), 0))} detail={explanation.endDate ?? '未知'} />
              <Kpi label="余额变化" value={money(explanation.totalChange)} detail="不是投资收益" />
              <Kpi label="资产变化率" value={percent(explanation.totalChangeRate)} detail="无法拆分净投入" />
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{explanation.interpretation}</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800">渠道贡献</h3>
            <div className="mt-2 divide-y divide-slate-100">
              {explanation.channels.map((channel) => (
                <div key={channel.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-700">{channel.name}</span>
                  <span className="tabular text-slate-500">{money(channel.start)} → {money(channel.end)}</span>
                  <span className={`tabular font-medium ${(channel.change ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(channel.change)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-slate-800">可追溯事件</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {explanation.reports.map((report) => (
                <button key={report.id} type="button" className="rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50" onClick={() => navigate({ tab: 'reports', reportId: report.id })}>
                  <span className="block font-medium">{report.title}</span>
                  <span className="text-xs text-slate-500">报告截至 {report.endDate}</span>
                </button>
              ))}
              {explanation.financeTasks.map((task) => (
                <button key={task.id} type="button" className="rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50" onClick={() => navigate({ tab: 'monthly', financeTaskKind: task.kind, financeTaskId: task.id })}>
                  <span className="block font-medium">{task.title}</span>
                  <span className="text-xs text-slate-500">理财任务快照 {task.snapshotAsOf}</span>
                </button>
              ))}
            </div>
            {explanation.classificationEvents.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">区间内包含 {explanation.classificationEvents.length} 个分类事件，均不代表交易或新增投入。</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function amountValue(value: number, hidden: boolean): string {
  return hidden ? '••••' : formatCNY(value);
}

function historySourceText(source?: string): string {
  if (source === 'live-snapshot') return '实时快照';
  if (source === 'manual') return '手动记录';
  if (source === 'weekly-report') return '周报生成';
  if (source === 'import') return '导入记录';
  return source ? source : '来源未记录';
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'up' | 'down';
}) {
  return (
    <Card className="p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular ${tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-800'}`}>{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{detail}</div>
    </Card>
  );
}
