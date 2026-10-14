import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '../../components/ui/primitives';

/** Keep existing pages and dialogs mounted while a storage maintenance operation runs. */
export function MaintenanceOverlay({ label }: { label: string }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousInert = new Map<HTMLElement, string | null>();

    function blockBackground() {
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child === overlay) continue;
        if (!previousInert.has(child)) previousInert.set(child, child.getAttribute('inert'));
        child.setAttribute('inert', '');
      }
    }

    function blockKey(event: KeyboardEvent) {
      if (['Tab', 'Escape', 'Enter', ' '].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function keepFocus(event: FocusEvent) {
      // Older open dialogs also listen to focusin; the maintenance surface takes precedence.
      event.stopImmediatePropagation();
      if (!overlay!.contains(event.target as Node)) overlay!.focus();
    }

    blockBackground();
    document.body.style.overflow = 'hidden';
    const observer = new MutationObserver(blockBackground);
    observer.observe(document.body, { childList: true });
    document.addEventListener('keydown', blockKey, true);
    document.addEventListener('focusin', keepFocus, true);
    overlay.focus();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', blockKey, true);
      document.removeEventListener('focusin', keepFocus, true);
      for (const [node, value] of previousInert) {
        if (value === null) node.removeAttribute('inert');
        else node.setAttribute('inert', value);
      }
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div ref={overlayRef} className="maintenance-overlay" role="status" aria-live="polite" tabIndex={-1}>
      <div className="maintenance-status">
        <div aria-hidden="true"><Spinner className="h-6 w-6 text-emerald-600" /></div>
        <h2>{label}</h2>
        <p>正在保护并校验数据，请等待操作完成。</p>
      </div>
    </div>,
    document.body,
  );
}
