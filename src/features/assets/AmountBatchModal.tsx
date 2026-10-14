import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Channel } from '../../types';
import { formatCNY, parseMoney } from '../../utils/money';
import type { AmountBatchChange, AmountBatchProposal } from './amountBatch';

interface AmountBatchModalProps {
  channels: Channel[];
  onClose: () => void;
  onPrepare: (changes: AmountBatchChange[]) => AmountBatchProposal;
  onConfirm: (proposal: AmountBatchProposal) => Promise<unknown>;
}

interface EditableRow {
  parentId: string;
  childId?: string;
  path: string;
  current: number;
  raw: string;
}

function rowsFor(channels: Channel[]): EditableRow[] {
  return channels.flatMap((parent) => {
    if (parent.children?.length) {
      return parent.children.map((child) => ({
        parentId: parent.id,
        childId: child.id,
        path: `${parent.name} / ${child.name}`,
        current: child.amount,
        raw: '',
      }));
    }
    return [{ parentId: parent.id, path: parent.name, current: parent.amount, raw: '' }];
  });
}

export function AmountBatchModal({ channels, onClose, onPrepare, onConfirm }: AmountBatchModalProps) {
  const amountsHidden = useWorkspaceStore((state) => state.amountsHidden);
  const [rows, setRows] = useState<EditableRow[]>(() => rowsFor(channels));
  const [proposal, setProposal] = useState<AmountBatchProposal | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!amountsHidden) return;
    setRows((current) => current.some((row) => row.raw !== '')
      ? current.map((row) => ({ ...row, raw: '' }))
      : current);
    setProposal(null);
  }, [amountsHidden]);

  const parsed = useMemo(() => rows.map((row) => {
    const amount = row.raw.trim() === '' ? null : parseMoney(row.raw);
    return { row, amount, invalid: row.raw.trim() !== '' && amount === null };
  }), [rows]);
  const invalidCount = parsed.filter(({ invalid }) => invalid).length;

  function prepare() {
    if (invalidCount) {
      setError('请先修正标出的金额。金额必须是非负数字，千分位需正确分组。');
      return;
    }
    const changes = parsed.flatMap(({ row, amount, invalid }) => !invalid && amount !== null && amount !== row.current
      ? [{ parentId: row.parentId, childId: row.childId, amount }]
      : []);
    if (!changes.length) {
      setError('金额没有变化');
      setProposal(null);
      return;
    }
    try {
      setProposal(onPrepare(changes));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成预览');
      setProposal(null);
    }
  }

  async function confirm() {
    if (!proposal || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm(proposal);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
      setProposal(null);
    } finally {
      setSaving(false);
    }
  }

  const shownMoney = (amount: number) => amountsHidden ? '¥••••' : formatCNY(amount);

  return (
    <Modal
      open
      onClose={onClose}
      title="批量更新金额"
      size="lg"
      footer={proposal ? <>
        <Button variant="ghost" onClick={() => setProposal(null)} disabled={saving}>返回修改</Button>
        <Button onClick={confirm} disabled={saving}>{saving ? '保存中…' : '确认保存'}</Button>
      </> : <>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={prepare}>预览变更</Button>
      </>}
    >
      {proposal ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
            <span>变更 {proposal.changes.length} 项</span>
            <span className="tabular-nums">总资产：{shownMoney(proposal.oldTotal)} → {shownMoney(proposal.newTotal)}</span>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr><th className="px-3 py-2 font-medium">渠道</th><th className="px-3 py-2 text-right font-medium">原金额</th><th className="px-3 py-2 text-right font-medium">新金额</th></tr>
              </thead>
              <tbody>
                {proposal.changes.map((change) => <tr key={`${change.parentId}:${change.childId ?? ''}`} className="border-t border-slate-100">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{change.path}</th>
                  <td className="px-3 py-2 text-right tabular-nums">{shownMoney(change.before)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{shownMoney(change.after)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {amountsHidden && <p className="text-xs text-slate-500">金额隐私模式已开启，预览中的金额已隐藏。</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">填写需要更新的项目，留空表示保持不变。父渠道有子渠道时，请编辑子渠道金额。</p>
          <div className="max-h-[60vh] divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
            {rows.map((row, index) => {
              const invalid = parsed[index]?.invalid ?? false;
              const inputId = `amount-batch-${index}`;
              return <div key={`${row.parentId}:${row.childId ?? ''}`} className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,9rem)_minmax(8rem,12rem)] items-center gap-3 px-3 py-2.5">
                <label htmlFor={inputId} className="min-w-0 truncate text-sm font-medium" title={row.path}>{row.path}</label>
                <span aria-label={`${row.path}当前金额`} className="text-right text-sm tabular-nums text-slate-500">{formatCNY(row.current)}</span>
                <div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" aria-hidden>¥</span>
                    <input
                      id={inputId}
                      aria-label={`${row.path}金额`}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? `${inputId}-error` : undefined}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="留空不变"
                      value={row.raw}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setRows((current) => current.map((item, i) => i === index ? { ...item, raw } : item));
                        setProposal(null);
                        setError('');
                      }}
                      className={`w-full rounded-md border bg-white py-2 pl-7 pr-3 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-500 ${invalid ? 'border-red-500' : 'border-slate-300'}`}
                    />
                  </div>
                  {invalid && <span id={`${inputId}-error`} className="sr-only">请输入有效金额</span>}
                </div>
              </div>;
            })}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    </Modal>
  );
}
