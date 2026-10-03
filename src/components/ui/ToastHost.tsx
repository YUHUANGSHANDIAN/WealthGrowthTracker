import { createPortal } from 'react-dom';
import { useAppStore, type ToastKind } from '../../store/appStore';

const KIND_STYLES: Record<ToastKind, { icon: string; ring: string }> = {
  success: { icon: '✅', ring: 'border-emerald-200' },
  error: { icon: '⚠️', ring: 'border-red-200' },
  info: { icon: '💡', ring: 'border-blue-200' },
};

export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4"
      role="region"
      aria-label="通知"
    >
      {toasts.map((t) => {
        const style = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full flex items-start gap-2 bg-white border ${style.ring} rounded-xl shadow-lg px-4 py-3 text-sm text-slate-700`}
          >
            <span className="shrink-0" aria-hidden>
              {style.icon}
            </span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-300 hover:text-slate-500"
              aria-label="关闭通知"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
