import { useState } from 'react';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { TextArea } from '../../components/ui/form';

interface HistoryEventNoteModalProps {
  date: string;
  initialNote: string;
  baseRevision: number;
  onClose: () => void;
  onSave: (date: string, note: string, baseRevision: number) => Promise<void>;
}

export function HistoryEventNoteModal({ date, initialNote, baseRevision, onClose, onSave }: HistoryEventNoteModalProps) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = note !== initialNote;

  function requestClose() {
    if (saving) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }

  async function save() {
    if (saving) return;
    if (note.length > 2000) {
      setError('事件备注最多 2000 字');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(date, note.trim(), baseRevision);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '备注保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal open title={`${date} · 事件备注`} onClose={requestClose} size="md" footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" disabled={saving} onClick={requestClose}>取消</Button>
          <Button className="min-h-[44px]" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '正在保存…' : '保存备注'}</Button>
        </>
      }>
        <div className="space-y-4" aria-busy={saving}>
          <p className="text-sm leading-relaxed text-slate-600">记录当天发生的事件，帮助以后回顾资产变化。这不是现金流台账，备注不会被计入收入、支出或投资收益。</p>
          <TextArea
            label="事件备注" value={note} onChange={event => setNote(event.target.value)}
            rows={6} maxLength={2000} disabled={saving} error={error || undefined}
            hint="例如：调整资产分类、家庭支出安排。清空内容并保存即可移除备注。"
            placeholder="为这一天留下一条说明…"
          />
          <p className="text-xs text-right text-slate-500" aria-live="polite">{note.length} / 2000 字</p>
          <p className="text-xs leading-relaxed text-slate-500">备注保存在本地。金额隐私开启时会隐藏备注全文，避免备注中的金额被展示。</p>
        </div>
      </Modal>
      <ConfirmDialog
        open={discardOpen} title="放弃未保存的备注？" message="当前修改尚未保存。放弃后将保留原来的事件备注。"
        confirmLabel="放弃修改" cancelLabel="继续编辑" onCancel={() => setDiscardOpen(false)} onConfirm={onClose}
      />
    </>
  );
}
