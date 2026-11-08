import { useId, useState } from 'react';
import type { DraftSaveStatus } from '../../hooks/useWorkspaceDraft';
import type { WorkspaceDraft } from '../../domain/workspace/types';
import { Modal } from './Modal';
import { Button } from './primitives';

export function DraftStatusBar({
  status,
  error,
  staleDraft,
  onSave,
  onDiscard,
  onRebase,
}: {
  status: DraftSaveStatus;
  error?: string | null;
  staleDraft?: WorkspaceDraft | null;
  onSave?: () => void;
  onDiscard?: () => void;
  onRebase?: () => void;
}) {
  const titleId = useId();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  if (status === 'idle') return null;
  const text = status === 'dirty' ? '草稿待保存'
    : status === 'saving' ? '正在保存草稿…'
      : status === 'saved' ? '草稿已保存，尚未提交'
        : status === 'restored' ? '已恢复本地草稿'
          : status === 'stale' ? '源数据已变化，草稿需要重新核对'
            : error ?? '草稿保存失败';
  const staleFields = staleDraft ? Object.keys(staleDraft.payload) : [];
  return (
    <>
      <div className={`draft-status draft-${status}`} role="status">
        <span>{text}</span>
        {status === 'dirty' && onSave && <button type="button" onClick={onSave}>立即保存</button>}
        {status === 'stale' && onRebase && <button type="button" onClick={() => setRecoveryOpen(true)}>查看旧草稿</button>}
        {(status === 'dirty' || status === 'saved' || status === 'stale' || status === 'error') && onDiscard && (
          <button type="button" onClick={onDiscard}>丢弃草稿</button>
        )}
      </div>
      <Modal
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title="旧草稿需要重新核对"
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setRecoveryOpen(false)}>保留当前内容</Button>
          <Button
            variant="danger"
            onClick={() => {
              setRecoveryOpen(false);
              onRebase?.();
            }}
          >
            恢复旧草稿
          </Button>
        </>}
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p id={titleId}>权威数据或对象 revision 已变化。旧草稿不会自动覆盖当前内容；恢复后仍需逐项核对并重新保存。</p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div>旧草稿基线 revision：{staleDraft?.baseRevision ?? '未知'} / 实体 revision {staleDraft?.baseEntityRevision ?? '未知'}</div>
            <div className="mt-1">草稿保存时间：{staleDraft?.updatedAt ? new Date(staleDraft.updatedAt).toLocaleString('zh-CN') : '未知'}</div>
            <div className="mt-1 break-words">包含字段：{staleFields.length ? staleFields.join('、') : '无可恢复字段'}</div>
          </div>
          <p className="text-xs text-slate-500">此操作只恢复编辑草稿，不会修改账本、历史、报告或已批准任务。</p>
        </div>
      </Modal>
    </>
  );
}
