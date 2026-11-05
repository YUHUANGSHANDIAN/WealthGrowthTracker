import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { formatCNY, parseMoney } from '../../utils/money';
import { todayString } from '../../utils/date';
import { Card, Button, Badge, EmptyState } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { TextField } from '../../components/ui/form';
import type { HistoryEditProposal } from './transaction';
import { HistoryRecords } from './HistoryRecords';
import { buildHistoryRows, historySource, isHistoryDate } from './historyView';
import { useNavigationStore } from '../../store/navigationStore';

export function HistoryPanel() {
  const history = useAppStore((s) => s.history);
  const hidden = useWorkspaceStore((s) => s.amountsHidden);
  const { prepareHistoryEdit, confirmHistoryEdit, deleteHistoryPoints } = useAppStore();
  const navigate = useNavigationStore((state) => state.navigate);

  const [formOpen, setFormOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [date, setDate] = useState(todayString());
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState('');
  const [openingRevision, setOpeningRevision] = useState(0);
  const [initialInput, setInitialInput] = useState({ date: '', amount: '' });
  const [proposal, setProposal] = useState<HistoryEditProposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingDates, setDeletingDates] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const sortedAsc = useMemo(() => buildHistoryRows(history), [history]);
  const rangeInvalid = !!rangeStart && !!rangeEnd && rangeStart > rangeEnd;

  const filtered = useMemo(() => {
    if (rangeInvalid) return [];
    let list = sortedAsc;
    if (rangeStart) list = list.filter((row) => row.point.date >= rangeStart);
    if (rangeEnd) list = list.filter((row) => row.point.date <= rangeEnd);
    return list;
  }, [sortedAsc, rangeStart, rangeEnd, rangeInvalid]);

  useEffect(() => {
    if (hidden) { setAmount(''); setFormOpen(false); setProposal(null); setDiscardOpen(false); }
  }, [hidden]);

  function openAdd() {
    setEditingDate(null);
    setDate(todayString());
    setAmount('');
    setError('');
    setOpeningRevision(useAppStore.getState().dataRevision);
    setInitialInput({ date: todayString(), amount: '' });
    setProposal(null);
    setFormOpen(true);
  }
  function openEdit(d: string, amt: number) {
    setEditingDate(d);
    setDate(d);
    setAmount(hidden ? '' : String(amt));
    setError('');
    setOpeningRevision(useAppStore.getState().dataRevision);
    setInitialInput({ date: d, amount: String(amt) });
    setProposal(null);
    setFormOpen(true);
  }
  function submit() {
    const value = parseMoney(amount);
    if (value === null) {
      setError('请输入有效金额');
      return;
    }
    if (!isHistoryDate(date)) {
      setError('请输入有效日期');
      return;
    }
    try {
      setError('');
      setProposal(prepareHistoryEdit({ sourceDate: editingDate ?? undefined, date, totalAmount: value }, openingRevision));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '历史记录保存失败，请重试'); }
  }

  function closeForm() {
    if (saving) return;
    if (date !== initialInput.date || amount !== initialInput.amount) { setDiscardOpen(true); return; }
    setFormOpen(false);
  }

  async function confirmEdit() {
    if (!proposal || saving) return;
    setSaving(true);
    setError('');
    try {
      await confirmHistoryEdit(proposal, !!proposal.occupied);
      setProposal(null);
      setFormOpen(false);
      if (editingDate && editingDate !== proposal.after.date) {
        setSelected(previous => new Set([...previous].filter(recordDate => recordDate !== editingDate)));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '历史记录保存失败，请重试');
    } finally { setSaving(false); }
  }

  function toggleSelect(d: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const display = [...filtered].reverse();
  const selectedDates = [...new Set(history.filter(point => selected.has(point.date)).map(point => point.date))];
  const observedDays = new Set(filtered.filter(row => row.validDate && !row.future && row.coverage.kind !== 'invalid').map(row => row.point.date)).size;
  const firstDate = rangeStart || filtered.find(row => row.validDate)?.point.date;
  const lastDate = rangeEnd || [...filtered].reverse().find(row => row.validDate)?.point.date;
  const spanDays = firstDate && lastDate && isHistoryDate(firstDate) && isHistoryDate(lastDate) && !rangeInvalid
    ? Math.round((Date.parse(lastDate) - Date.parse(firstDate)) / 86_400_000) + 1 : null;

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm leading-relaxed text-slate-600">按日回顾资产快照与事件。缺失日期保留断点；事件备注只帮助回忆，不构成现金流台账。</p>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold text-slate-800">快照覆盖</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1 text-xs text-slate-500">起始日期
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="mt-1 min-h-[44px] w-full min-w-0 px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              aria-label="起始日期"
            />
            </label>
            <label className="min-w-0 flex-1 text-xs text-slate-500">结束日期
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="mt-1 min-h-[44px] w-full min-w-0 px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              aria-label="结束日期"
            />
            </label>
            {(rangeStart || rangeEnd) && <Button variant="ghost" size="sm" className="min-h-[44px] self-end" onClick={() => { setRangeStart(''); setRangeEnd(''); }}>清除筛选</Button>}
          </div>
        </div>
        {rangeInvalid && <p className="mb-3 text-sm text-red-600" role="alert">起始日期不能晚于结束日期。</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="text-2xl font-semibold tabular text-slate-800">{observedDays} 个有效记录日</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {spanDays !== null && spanDays > 0 ? `筛选范围共 ${spanDays} 天。` : '选择日期范围以查看覆盖。'}
              未记录日期不补零；趋势、渠道结构与变动解读统一在「资产历史趋势」中查看。
            </p>
          </div>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => navigate({ tab: 'analysis', startDate: rangeStart || undefined, endDate: rangeEnd || undefined })}
          >
            打开资产历史趋势
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-800">历史记录</h2>
          <Badge tone="slate">{filtered.length} 条</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedDates.length > 0 && (
            <Button variant="danger" size="sm" className="min-h-[44px]" onClick={() => { setDeleteError(''); setDeletingDates(selectedDates); }}>
              删除所选 ({selectedDates.length})
            </Button>
          )}
          <Button size="sm" className="min-h-[44px]" onClick={openAdd} disabled={hidden}>
            ＋ 添加历史
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {display.length === 0 ? (
          <EmptyState icon="🗓️" title="暂无记录" description="手动添加历史数据，或调整日期筛选范围。" />
        ) : (
          <HistoryRecords rows={display} selected={selected} onToggleSelect={toggleSelect} onEdit={openEdit} onDelete={recordDate => { setDeleteError(''); setDeletingDates([recordDate]); }} />
        )}
      </Card>

      {/* 添加/编辑历史 */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingDate ? '编辑历史记录' : '添加历史记录'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>取消</Button>
            <Button onClick={submit} disabled={saving}>预览变更</Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={error && !isHistoryDate(date) ? error : undefined} />
          <TextField label="总资产" type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="支持千分位金额，如 12,345.67" error={error && isHistoryDate(date) ? error : undefined} />
          <p className="text-xs text-slate-400">先预览日期与金额，再确认保存。金额变化时将移除原渠道构成；事件备注保留。</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={deletingDates !== null}
        title="删除历史记录"
        message={<><p>确定删除 {deletingDates?.length ?? 0} 条历史记录吗？对应的事件备注也会移除。请先确认已保留需要的备份。</p>{deleteError && <p className="mt-2 text-red-600" role="alert">{deleteError}</p>}</>}
        onCancel={() => setDeletingDates(null)}
        onConfirm={() => {
          if (!deletingDates) return;
          try {
            deleteHistoryPoints(deletingDates);
            setSelected(previous => new Set([...previous].filter(recordDate => !deletingDates.includes(recordDate))));
            setDeletingDates(null);
          } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '删除失败，请重试'); }
        }}
      />

      {proposal && (
        <Modal open onClose={() => { if (!saving) { setProposal(null); setError(''); } }} title="确认历史变更" size="sm"
          footer={
            <>
              <Button variant="ghost" disabled={saving} onClick={() => { setProposal(null); setError(''); }}>返回编辑</Button>
              <Button disabled={saving} onClick={() => void confirmEdit()}>{saving ? '正在保存…' : proposal.occupied ? '确认覆盖并保存' : '确认保存'}</Button>
            </>
          }>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{editingDate && editingDate !== proposal.after.date ? `${editingDate} → ${proposal.after.date}，原日期记录将在同一次保存中移除。` : `记录日期：${proposal.after.date}`}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-400">现有记录</div>
                <div className="font-semibold text-slate-700 tabular">{proposal.before ? formatCNY(proposal.before.totalAmount) : '无记录'}</div>
                {proposal.before && <div className="text-xs text-slate-400 mt-1">来源：{historySource(proposal.before.source).label}</div>}
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-xs text-emerald-600">新记录</div>
                <div className="font-semibold text-emerald-700 tabular">{formatCNY(proposal.after.totalAmount)}</div>
              </div>
            </div>
            {proposal.occupied && <p className="text-sm text-amber-700">目标日期已有 {formatCNY(proposal.occupied.totalAmount)} 的记录。确认将覆盖该记录及其备注，一天仅保留一条。</p>}
            {proposal.clearsComposition && <p className="text-sm text-amber-700">总额发生变化，原渠道构成将移除；这条记录将显示为「仅有总额」。</p>}
            {proposal.before?.eventNote && <p className="text-xs text-slate-500">原记录的事件备注将保留。</p>}
            {!proposal.changed && <p className="text-sm text-slate-500">日期和金额均未改变，无需写入。</p>}
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      <ConfirmDialog open={discardOpen} title="放弃未保存的历史变更？" message="日期和金额尚未保存。" confirmLabel="放弃修改" cancelLabel="继续编辑" onCancel={() => setDiscardOpen(false)} onConfirm={() => { setDiscardOpen(false); setFormOpen(false); setProposal(null); }} />
    </div>
  );
}
