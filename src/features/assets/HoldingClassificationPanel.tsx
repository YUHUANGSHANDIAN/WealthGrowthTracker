import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { useAppStore } from '../../store/appStore';
import { projectMonthlyPlanningClassification } from '../../domain/assets/classification';
import { formatCNY } from '../../utils/money';
import { useNavigationStore } from '../../store/navigationStore';
import { checkClassificationHealth } from '../../utils/dataHealth';

function productKindLabel(value: string): string {
  if (value === 'fund-etf-feeder') return 'ETF 联接基金';
  if (value === 'bank-gold-accumulation') return '银行黄金积存';
  if (value === 'fund-other') return '基金';
  if (value === 'cash') return '现金';
  if (value === 'fixed-income') return '固收';
  return '其他';
}

export function HoldingClassificationPanel() {
  const channels = useAppStore((state) => state.channels);
  const planning = useAppStore((state) => state.monthlyPlanning);
  const classifications = useAppStore((state) => state.assetClassification);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'gold' | 'fund' | 'review'>('all');
  const [shareClass, setShareClass] = useState('all');
  const [observedFrom, setObservedFrom] = useState('');
  const [observedTo, setObservedTo] = useState('');
  const [sort, setSort] = useState<'name' | 'date' | 'value'>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigationStore((state) => state.navigate);
  const routeHoldingId = useNavigationStore((state) => state.holdingId);
  const channelNames = useMemo(() => new Map(channels.flatMap((channel) => [
    [channel.id, channel.name] as const,
    ...(channel.children ?? []).map((child) => [child.id, child.name] as const),
  ])), [channels]);
  const projected = useMemo(
    () => projectMonthlyPlanningClassification(planning, classifications),
    [planning, classifications],
  );
  const rows = useMemo(() => projected.sessions.flatMap((task) => {
    const observations = new Map(task.observations.map((observation) => [observation.holdingId, observation]));
    return task.holdings.map((holding) => ({
      task,
      holding,
      observation: observations.get(holding.id) ?? null,
      classification: classifications.events
        .filter((event) => event.target.type === 'holding'
          && event.target.taskId === task.key
          && event.target.id === holding.id)
        .sort((a, b) => b.classifiedAt.localeCompare(a.classifiedAt))[0]?.after ?? null,
    }));
  }), [classifications.events, projected.sessions]);
  const shareClasses = useMemo(
    () => [...new Set(rows.map(({ holding }) => holding.shareClass).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh')),
    [rows],
  );
  const filtered = rows.filter(({ task, holding, observation, classification }) => {
    const text = `${holding.originalName} ${holding.fundCode ?? ''} ${holding.childChannelId ?? ''} ${classification?.productKind ?? ''}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (filter === 'gold' && !holding.exposureTags.includes('gold')) return false;
    if (filter === 'review' && !(observation?.quality.review !== 'passed' || !holding.childChannelId)) return false;
    if (filter === 'fund' && holding.productType !== 'fund') return false;
    if (shareClass !== 'all' && holding.shareClass !== shareClass) return false;
    if (observedFrom && task.snapshotAsOf < observedFrom) return false;
    if (observedTo && task.snapshotAsOf > observedTo) return false;
    return true;
  });
  const visibleRows = [...filtered].sort((a, b) => {
    if (sort === 'date') return b.task.snapshotAsOf.localeCompare(a.task.snapshotAsOf);
    if (sort === 'value') return (b.observation?.marketValue ?? -1) - (a.observation?.marketValue ?? -1);
    return a.holding.originalName.localeCompare(b.holding.originalName, 'zh');
  });
  useEffect(() => {
    setSelectedId(routeHoldingId ?? null);
  }, [routeHoldingId]);
  const healthIssues = useMemo(
    () => checkClassificationHealth(channels, planning, classifications),
    [channels, classifications, planning],
  );
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">产品持仓分类</h2>
          <p className="mt-1 text-xs text-slate-500">产品明细用于基金分析和黄金敞口，不参与当前渠道总资产二次汇总。</p>
        </div>
        <Badge tone="slate">{visibleRows.length} 条</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按名称、代码或子渠道筛选"
          aria-label="筛选产品持仓"
          className="min-h-[40px] min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
          aria-label="产品分类筛选"
          className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="all">全部产品</option>
          <option value="fund">基金</option>
          <option value="gold">黄金敞口</option>
          <option value="review">待核对</option>
        </select>
        <select
          value={shareClass}
          onChange={(event) => setShareClass(event.target.value)}
          aria-label="份额类别筛选"
          className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="all">全部份额类别</option>
          {shareClasses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="text-xs text-slate-500">观察起<input type="date" value={observedFrom} onChange={(event) => setObservedFrom(event.target.value)} className="ml-1 min-h-[40px] rounded-lg border border-slate-300 px-2" /></label>
        <label className="text-xs text-slate-500">观察止<input type="date" value={observedTo} onChange={(event) => setObservedTo(event.target.value)} className="ml-1 min-h-[40px] rounded-lg border border-slate-300 px-2" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="持仓排序" className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="name">按名称</option>
          <option value="date">按观察日</option>
          <option value="value">按市值</option>
        </select>
      </div>
      {visibleRows.length === 0 ? (
        <EmptyState title="没有匹配的产品" description="调整搜索或筛选条件；已归档任务会使用分类账本只读投影。" />
      ) : (
        <div className="mt-3 max-h-[460px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="px-3 py-2" scope="col">产品</th>
                <th className="px-3 py-2" scope="col">归属</th>
                <th className="px-3 py-2" scope="col">类型</th>
                <th className="px-3 py-2" scope="col">份额类别</th>
                <th className="px-3 py-2" scope="col">风险敞口</th>
                <th className="px-3 py-2 text-right" scope="col">最近观察值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map(({ task, holding, observation, classification }) => (
                <tr
                  key={`${task.key}:${holding.id}`}
                  className={`cursor-pointer hover:bg-slate-50/60 ${selectedId === `${task.key}:${holding.id}` ? 'bg-emerald-50/70' : ''}`}
                  onClick={() => {
                    const id = `${task.key}:${holding.id}`;
                    setSelectedId(id);
                    navigate({ tab: 'assets', assetView: 'holdings', holdingId: id });
                  }}
                >
                  <th scope="row" className="max-w-[280px] px-3 py-2 font-medium text-slate-700">
                    <span className="block truncate" title={holding.originalName}>{holding.originalName}</span>
                    <span className="block text-[10px] font-normal text-slate-400">{holding.fundCode ?? '代码未知'} · {task.snapshotAsOf} · {task.title || task.key}</span>
                  </th>
                  <td className="px-3 py-2 text-xs text-slate-500">{channelNames.get(holding.parentChannelId) ?? holding.parentChannelId}{holding.childChannelId ? ` / ${channelNames.get(holding.childChannelId) ?? holding.childChannelId}` : ''}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{productKindLabel(classification?.productKind ?? 'other')}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{holding.shareClass ?? '未记录'}</td>
                  <td className="px-3 py-2 text-xs">
                    {holding.exposureTags.length ? holding.exposureTags.map((tag) => <Badge key={tag} tone={tag === 'gold' ? 'amber' : 'slate'}>{tag}</Badge>) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-slate-700">{observation?.marketValue == null ? '未知' : formatCNY(observation.marketValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(() => {
        const selected = rows.find(({ task, holding }) => `${task.key}:${holding.id}` === selectedId);
        if (!selected) return null;
        const { task, holding, observation, classification } = selected;
        const sourceById = new Map(task.documents.map((document) => [document.id, document]));
        const events = classifications.events
          .filter((event) => event.target.type === 'holding' && event.target.taskId === task.key && event.target.id === holding.id)
          .sort((a, b) => a.classifiedAt.localeCompare(b.classifiedAt));
        return (
          <Modal open placement="right" size="lg" onClose={() => { setSelectedId(null); navigate({ tab: 'assets', assetView: 'holdings' }); }} title={holding.originalName}>
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
                这是任务「{task.title || task.key}」在 {task.snapshotAsOf} 的历史观察，不是当前实时持仓，也不替代渠道余额。
              </div>
              <section>
                <h3 className="font-semibold">身份与归属</h3>
                <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-slate-500">稳定持仓 ID</dt><dd className="break-all">{holding.id}</dd>
                  <dt className="text-slate-500">账户/渠道</dt><dd>{holding.parentChannelId}{holding.childChannelId ? ` / ${holding.childChannelId}` : ' / 未归属子渠道'}</dd>
                  <dt className="text-slate-500">基金代码</dt><dd>{holding.fundCode ?? '未知'}</dd>
                  <dt className="text-slate-500">份额类别</dt><dd>{holding.shareClass ?? '未记录'}</dd>
                  <dt className="text-slate-500">产品类型</dt><dd>{productKindLabel(classification?.productKind ?? holding.productType)}</dd>
                  <dt className="text-slate-500">风险敞口</dt><dd>{holding.exposureTags.join('、') || '未记录'}</dd>
                </dl>
              </section>
              <section>
                <h3 className="font-semibold">原始观察与质量</h3>
                {observation ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <ObservationRow label="市值" value={observation.marketValue == null ? '未知' : formatCNY(observation.marketValue)} />
                    <ObservationRow label="份额" value={observation.shares ?? '未知'} />
                    <ObservationRow label="净值" value={observation.nav ?? '未知'} />
                    <ObservationRow label="净值日期" value={observation.navDate ?? '未知'} />
                    <ObservationRow label="来源" value={observation.quality.source} />
                    <ObservationRow label="审核" value={observation.quality.review} />
                  </div>
                ) : <p className="mt-2 text-slate-500">没有对应观察记录。</p>}
              </section>
              <section>
                <h3 className="font-semibold">来源证据</h3>
                {observation?.evidence.length ? (
                  <div className="mt-2 space-y-2">
                    {observation.evidence.map((reference, index) => {
                      const document = sourceById.get(reference.sourceId);
                      return (
                        <div key={`${reference.sourceId}:${index}`} className="rounded-lg border border-slate-200 p-2 text-xs">
                          <div className="font-medium">{document?.originalName ?? reference.sourceId}</div>
                          <div className="mt-1 text-slate-500">
                            {reference.tableIndex !== undefined ? `表 ${reference.tableIndex + 1} · ` : ''}
                            {reference.rowIndex !== undefined ? `行 ${reference.rowIndex + 1} · ` : ''}
                            {reference.cellIndex !== undefined ? `列 ${reference.cellIndex + 1}` : reference.excerpt ?? '结构化引用'}
                          </div>
                          {reference.excerpt && <p className="mt-1 break-words text-slate-600">{reference.excerpt}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="mt-2 text-xs text-slate-500">没有可定位证据；保持待核对，不自动合并或补金额。</p>}
              </section>
              <section>
                <h3 className="font-semibold">分类事件</h3>
                {events.length ? <ol className="mt-2 space-y-2 text-xs">{events.map((event) => (
                  <li key={event.id} className="rounded-lg bg-slate-50 p-2">
                    <div className="font-medium">{event.kind} · {event.source}</div>
                    <div className="mt-1 text-slate-500">{event.classifiedAt} · {event.reason}</div>
                  </li>
                ))}</ol> : <p className="mt-2 text-xs text-slate-500">尚无分类修订事件。</p>}
              </section>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Button size="sm" onClick={() => navigate({ tab: 'monthly', financeTaskKind: task.taskKind ?? 'monthly-review', financeTaskId: task.key })}>打开关联任务</Button>
                {(() => {
                  const related = healthIssues.find((issue) => issue.evidenceRefs.some((reference) =>
                    reference.kind === 'holding'
                    && reference.id === holding.id
                    && reference.taskId === task.key));
                  return related ? (
                    <Button size="sm" variant="outline" onClick={() => navigate({ tab: 'data', healthIssueId: related.id })}>查看相关核对项</Button>
                  ) : null;
                })()}
              </div>
            </div>
          </Modal>
        );
      })()}
    </Card>
  );
}

function ObservationRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-0.5 font-medium text-slate-700">{value}</div></div>;
}
