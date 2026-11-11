import { useEffect, useMemo, useState } from 'react';
import type { FinancialReport } from '../../types';
import { useAppStore } from '../../store/appStore';
import { Badge, EmptyState } from '../../components/ui/primitives';
import { diffReportFields } from '../../utils/reportEdit';
import { formatCNY } from '../../utils/money';

export function ReportRevisionViewer({
  report,
  initialFromId,
  initialToId,
  onSelectionChange,
}: {
  report: FinancialReport;
  initialFromId?: string;
  initialToId?: string;
  onSelectionChange?: (fromId: string, toId: string) => void;
}) {
  const state = useAppStore((store) => store.reportRevisions);
  const revisions = useMemo(
    () => state.revisions.filter((item) => item.reportId === report.id).sort((a, b) => b.revision - a.revision),
    [report.id, state.revisions],
  );
  const candidates = useMemo(() => [
    { id: 'current', label: `当前 r${report.revision ?? 1}`, report },
    ...revisions.map((revision) => ({
      id: revision.id,
      label: `r${revision.revision} · ${revision.action} · ${revision.capturedAt.replace('T', ' ').slice(0, 19)}`,
      report: revision.snapshot as unknown as FinancialReport,
    })),
  ], [report, revisions]);
  const [fromId, setFromId] = useState(
    candidates.some((item) => item.id === initialFromId) ? initialFromId! : revisions[0]?.id ?? 'current',
  );
  const [toId, setToId] = useState(
    candidates.some((item) => item.id === initialToId) ? initialToId! : 'current',
  );
  useEffect(() => {
    if (initialFromId && candidates.some((item) => item.id === initialFromId)) setFromId(initialFromId);
    if (initialToId && candidates.some((item) => item.id === initialToId)) setToId(initialToId);
  }, [candidates, initialFromId, initialToId]);
  const from = candidates.find((item) => item.id === fromId) ?? candidates[0]!;
  const to = candidates.find((item) => item.id === toId) ?? candidates[0]!;
  const diffs = diffReportFields(from.report, to.report);
  const fromRevision = revisions.find((item) => item.id === from.id);
  const toRevision = revisions.find((item) => item.id === to.id);

  function updateSelection(nextFrom: string, nextTo: string) {
    setFromId(nextFrom);
    setToId(nextTo);
    onSelectionChange?.(nextFrom, nextTo);
  }

  if (!revisions.length) {
    return (
      <section>
        <h3 className="font-semibold">修订历史</h3>
        <EmptyState icon="≡" title="还没有可比较的历史版本" description="旧报告会在首次正式修改时先保存当前快照，不批量伪造历史修订。" />
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">修订历史</h3>
          <p className="mt-1 text-xs text-slate-500">当前版本是只读事实；选择一个历史快照比较，不会回滚数据。</p>
        </div>
        <Badge tone="slate">{revisions.length} 个历史版本</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-500">旧版本
          <select value={from.id} onChange={(event) => updateSelection(event.target.value, to.id)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">比较版本
          <select value={to.id} onChange={(event) => updateSelection(from.id, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>旧：{fromRevision?.capturedAt.replace('T', ' ').slice(0, 19) ?? `r${from.report.revision ?? 1}`}</span>
          <span>·</span>
          <span>新：{toRevision?.capturedAt.replace('T', ' ').slice(0, 19) ?? `r${to.report.revision ?? 1}`}</span>
          {fromRevision && <><span>·</span><span>数据 revision {fromRevision.baseDataRevision}</span></>}
          {toRevision && <><span>·</span><span>数据 revision {toRevision.baseDataRevision}</span></>}
        </div>
        {(fromRevision || toRevision) && (
          <div className="mt-2 break-all text-[11px] text-slate-400">
            {fromRevision ? `旧 SHA-256 ${fromRevision.contentHash.slice(0, 12)}… ` : ''}
            {toRevision ? `新 SHA-256 ${toRevision.contentHash.slice(0, 12)}…` : ''}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <RevisionValue label="旧版总资产" value={formatCNY(from.report.totalAmount)} />
          <RevisionValue label="比较版总资产" value={formatCNY(to.report.totalAmount)} />
          <RevisionValue label="字段差异" value={`${diffs.length} 项`} />
        </div>
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
          {diffs.length ? diffs.map((diff) => (
            <div key={diff.field} className="grid gap-1 rounded bg-slate-50 p-2 sm:grid-cols-[130px_1fr_1fr]">
              <span className="font-medium text-slate-600">{diff.label}</span>
              <span className="break-words text-slate-500">旧：{stringifyDiff(diff.oldValue)}</span>
              <span className="break-words text-emerald-700">新：{stringifyDiff(diff.newValue)}</span>
            </div>
          )) : <p className="text-slate-500">所选版本字段一致。</p>}
        </div>
      </div>
    </section>
  );
}

function RevisionValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-slate-50 p-2"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 font-semibold tabular text-slate-700">{value}</div></div>;
}

function stringifyDiff(value: unknown): string {
  if (value === undefined || value === null) return '无';
  if (typeof value === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  if (typeof value === 'string') return value || '空';
  return JSON.stringify(value);
}
