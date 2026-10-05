import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { formatCNY, parseMoney } from '../../utils/money';
import { todayString } from '../../utils/date';
import { Card, Button, Badge, EmptyState } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { TextField, MoneyField } from '../../components/ui/form';
import { LineChart } from '../../components/charts/LineChart';
import { BRAND } from '../../components/charts/palette';
import type { HistoryPoint } from '../../types';

const SOURCE_META: Record<string, { label: string; tone: 'emerald' | 'blue' | 'purple' | 'slate' | 'amber' }> = {
  'live-snapshot': { label: '实时快照', tone: 'emerald' },
  manual: { label: '手动', tone: 'slate' },
  'weekly-report': { label: '周报生成', tone: 'blue' },
  import: { label: '导入', tone: 'purple' },
  'legacy-txt-import': { label: '旧版TXT', tone: 'amber' },
  'legacy-image-import': { label: '旧版图片', tone: 'amber' },
  'ocr-repair': { label: 'OCR修复', tone: 'amber' },
  'historical-backfill': { label: '历史补全', tone: 'blue' },
};

export function HistoryPanel() {
  const history = useAppStore((s) => s.history);
  const { addHistoryPoint, overwriteHistoryPoint, updateHistoryPoint, deleteHistoryPoint, deleteHistoryPoints } = useAppStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [date, setDate] = useState(todayString());
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState('');

  // 同日期冲突（手动添加 / 编辑日期撞车时触发）
  const [conflict, setConflict] = useState<{ date: string; amount: number; existing: HistoryPoint } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const sortedAsc = useMemo(() => [...history].sort((a, b) => (a.date < b.date ? -1 : 1)), [history]);

  const filtered = useMemo(() => {
    let list = sortedAsc;
    if (rangeStart) list = list.filter((p) => p.date >= rangeStart);
    if (rangeEnd) list = list.filter((p) => p.date <= rangeEnd);
    return list;
  }, [sortedAsc, rangeStart, rangeEnd]);

  const chartSeries = useMemo(
    () => [
      {
        id: 'total',
        name: '总资产',
        color: BRAND,
        points: filtered.map((p) => ({ date: p.date, value: p.totalAmount })),
        area: true,
      },
    ],
    [filtered],
  );

  function openAdd() {
    setEditingDate(null);
    setDate(todayString());
    setAmount('');
    setError('');
    setFormOpen(true);
  }
  function openEdit(d: string, amt: number) {
    setEditingDate(d);
    setDate(d);
    setAmount(String(amt));
    setError('');
    setFormOpen(true);
  }
  function submit() {
    const value = parseMoney(amount);
    if (value === null) {
      setError('请输入有效金额');
      return;
    }
    if (!date) {
      setError('请输入日期');
      return;
    }
    if (editingDate === null) {
      // 手动添加：同日期已存在 → 冲突，不静默覆盖
      const res = addHistoryPoint(date, value, 'manual');
      if (res.conflict && res.existing) {
        setConflict({ date, amount: value, existing: res.existing });
        return;
      }
    } else {
      if (date === editingDate) {
        // 同一天编辑金额：直接更新原记录
        updateHistoryPoint(date, value);
      } else {
        // 编辑日期到另一天：目标日期已有记录 → 冲突
        const existing = history.find((h) => h.date === date);
        if (existing) {
          setConflict({ date, amount: value, existing });
          return;
        }
        overwriteHistoryPoint(date, value, 'manual');
        deleteHistoryPoint(editingDate);
      }
    }
    setFormOpen(false);
  }

  function toggleSelect(d: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const display = [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">资产历史趋势</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              aria-label="起始日期"
            />
            <span className="text-xs text-slate-400 self-center">至</span>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              aria-label="结束日期"
            />
          </div>
        </div>
        {filtered.length > 0 ? (
          <LineChart series={chartSeries} ariaLabel="总资产历史趋势图" />
        ) : (
          <EmptyState icon="📊" title="暂无历史数据" description="添加历史记录后即可看到资产趋势。" />
        )}
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-800">历史记录</h2>
          <Badge tone="slate">{filtered.length} 条</Badge>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              删除所选 ({selected.size})
            </Button>
          )}
          <Button size="sm" onClick={openAdd}>
            ＋ 添加历史
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {display.length === 0 ? (
          <EmptyState icon="🗓️" title="暂无记录" description="手动添加历史数据，或调整日期筛选范围。" />
        ) : (
          <div className="divide-y divide-slate-100">
            {display.map((p) => (
              <div key={p.date} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/70">
                <input
                  type="checkbox"
                  checked={selected.has(p.date)}
                  onChange={() => toggleSelect(p.date)}
                  className="h-4 w-4 text-emerald-600 rounded"
                  aria-label={`选择 ${p.date}`}
                />
                <span className="text-sm text-slate-500 tabular w-28 shrink-0">{p.date}</span>
                <span className="flex-1 text-sm font-semibold text-slate-800 tabular">{formatCNY(p.totalAmount)}</span>
                {p.source && SOURCE_META[p.source] && (
                  <Badge tone={SOURCE_META[p.source]!.tone}>{SOURCE_META[p.source]!.label}</Badge>
                )}
                <button className="text-xs text-slate-500 hover:text-emerald-600" onClick={() => openEdit(p.date, p.totalAmount)}>
                  编辑
                </button>
                <button className="text-xs text-slate-400 hover:text-red-500" onClick={() => deleteHistoryPoint(p.date)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 添加/编辑历史 */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingDate ? '编辑历史记录' : '添加历史记录'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={submit}>{editingDate ? '保存' : '添加'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={error && !date ? error : undefined} />
          <MoneyField label="总资产" value={amount === '' ? '' : Number(amount)} onChange={(v) => setAmount(v === '' ? '' : String(v))} error={error && date ? error : undefined} />
          <p className="text-xs text-slate-400">提示：修改渠道金额会自动同步「今天」的历史记录。</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="批量删除历史"
        message={`确定删除选中的 ${selected.size} 条历史记录吗？此操作无法撤销。`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteHistoryPoints([...selected]);
          setSelected(new Set());
          setConfirmDelete(false);
        }}
      />

      {/* 同日期冲突：一天只能保留一条 */}
      {conflict && (
        <Modal open onClose={() => setConflict(null)} title="当天已有历史记录" size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConflict(null)}>取消</Button>
              <Button onClick={() => { overwriteHistoryPoint(conflict.date, conflict.amount, 'manual'); setConflict(null); setFormOpen(false); }}>覆盖当天记录</Button>
            </>
          }>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">日期 <span className="font-medium tabular">{conflict.date}</span> 已有一条历史记录。</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-400">现有记录</div>
                <div className="font-semibold text-slate-700 tabular">{formatCNY(conflict.existing.totalAmount)}</div>
                <div className="text-xs text-slate-400 mt-1">来源：{SOURCE_META[conflict.existing.source ?? '']?.label ?? '—'}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3">
                <div className="text-xs text-emerald-600">新记录</div>
                <div className="font-semibold text-emerald-700 tabular">{formatCNY(conflict.amount)}</div>
              </div>
            </div>
            <p className="text-xs text-slate-400">一天只能保留一条记录。覆盖会更新当天金额与快照。</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
