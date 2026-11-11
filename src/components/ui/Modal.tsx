import React, { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './primitives';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'center' | 'right';
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' } as const;

const dialogStack: HTMLElement[] = [];
let originalOverflow = '';

/** 可访问的基础模态框：portal 渲染、Escape 关闭、点击遮罩关闭、初始聚焦。 */
export function Modal({ open, onClose, title, children, footer, size = 'md', placement = 'center' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialogStack.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogStack.push(dialog);
    dialog.focus();
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialog) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const targets = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')).filter(el=>!el.hidden && el.getAttribute('aria-hidden')!=='true');
        if (!targets.length) { e.preventDefault(); dialog.focus(); return; }
        const first=targets[0]!, last=targets[targets.length-1]!;
        if(e.shiftKey && (document.activeElement===first || document.activeElement===dialog)) {e.preventDefault();last.focus();}
        else if(!e.shiftKey && (document.activeElement===last || document.activeElement===dialog)) {e.preventDefault();first.focus();}
      }
    };
    const onFocus = (e:FocusEvent) => { if(dialogStack[dialogStack.length - 1]===dialog && !dialog.contains(e.target as Node)) dialog.focus(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);document.removeEventListener('focusin',onFocus);
      const i=dialogStack.indexOf(dialog);if(i>=0)dialogStack.splice(i,1);
      if(!dialogStack.length)document.body.style.overflow=originalOverflow;
      if(previous?.isConnected)previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex p-4 ${placement === 'right' ? 'items-stretch justify-end' : 'items-center justify-center'}`}
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => { if (dialogStack[dialogStack.length - 1] === dialogRef.current) onClose(); }}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${SIZES[size]} bg-white shadow-2xl outline-none flex flex-col ${placement === 'right' ? 'h-full max-h-dvh rounded-l-2xl rounded-r-none' : 'rounded-2xl max-h-[90vh]'}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 id={titleId} className="text-lg font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 危险操作确认框。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600 leading-relaxed">{message}</div>
    </Modal>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
