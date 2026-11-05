import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState } from '../../components/ui/primitives';
import { useAppStore } from '../../store/appStore';
import { projectMonthlyPlanningClassification } from '../../domain/assets/classification';
import { formatCNY } from '../../utils/money';

function productKindLabel(value: string): string {
  if (value === 'fund-etf-feeder') return 'ETF 联接基金';
  if (value === 'bank-gold-accumulation') return '银行黄金积存';
  if (value === 'fund-other') return '基金';
  if (value === 'cash') return '现金';
  if (value === 'fixed-income') return '固收';
  return '其他';
}

export function HoldingClassificationPanel() {
  const planning = useAppStore((state) => state.monthlyPlanning);
  const classifications = useAppStore((state) => state.assetClassification);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'gold' | 'fund' | 'review'>('all');
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
  const filtered = rows.filter(({ holding, observation, classification }) => {
    const text = `${holding.originalName} ${holding.fundCode ?? ''} ${holding.childChannelId ?? ''} ${classification?.productKind ?? ''}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (filter === 'gold') return holding.exposureTags.includes('gold');
    if (filter === 'review') return observation?.quality.review !== 'passed' || !holding.childChannelId;
    if (filter === 'fund') return holding.productType === 'fund';
    return true;
  });
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">产品持仓分类</h2>
          <p className="mt-1 text-xs text-slate-500">产品明细用于基金分析和黄金敞口，不参与当前渠道总资产二次汇总。</p>
        </div>
        <Badge tone="slate">{filtered.length} 条</Badge>
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
      </div>
      {filtered.length === 0 ? (
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
              {filtered.map(({ task, holding, observation, classification }) => (
                <tr key={`${task.key}:${holding.id}`} className="hover:bg-slate-50/60">
                  <th scope="row" className="max-w-[280px] px-3 py-2 font-medium text-slate-700">
                    <span className="block truncate" title={holding.originalName}>{holding.originalName}</span>
                    <span className="block text-[10px] font-normal text-slate-400">{holding.fundCode ?? '代码未知'} · {task.snapshotAsOf}</span>
                  </th>
                  <td className="px-3 py-2 text-xs text-slate-500">{holding.parentChannelId}{holding.childChannelId ? ` / ${holding.childChannelId}` : ''}</td>
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
    </Card>
  );
}
