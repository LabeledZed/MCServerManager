import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

interface ToastRegionProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function announceToScreenReader(text: string, fallbackEl: HTMLElement | null): void {
  const doc = document as Document & { ariaNotify?: (msg: string) => void };
  if (typeof doc.ariaNotify === 'function') {
    doc.ariaNotify(text);
    return;
  }
  if (fallbackEl) {
    fallbackEl.textContent = '';
    requestAnimationFrame(() => {
      fallbackEl.textContent = text;
    });
  }
}

function ToastPopoverItem({
  toast,
  index,
  onDismiss,
}: {
  toast: ToastMessage;
  index: number;
  onDismiss: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let shown = false;
    let shownAt = 0;

    const tryShow = () => {
      if (shown) return;
      const modalOpen = Boolean(document.querySelector('dialog:modal'));
      if (!modalOpen && typeof el.showPopover === 'function') {
        try {
          el.showPopover();
          shown = true;
          shownAt = Date.now();
        } catch {
          shown = true;
          shownAt = Date.now();
        }
      }
    };

    tryShow();

    const timer = window.setInterval(() => {
      if (!shown) {
        tryShow();
        return;
      }
      if (!pausedRef.current && !document.querySelector('dialog:modal') && Date.now() - shownAt >= 5200) {
        onDismiss(toast.id);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      if (typeof el.hidePopover === 'function') {
        try {
          el.hidePopover();
        } catch {
          // ignore
        }
      }
    };
  }, [toast.id, onDismiss]);

  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' || toast.tone === 'warn' ? AlertCircle : Info;

  return (
    <div
      ref={ref}
      id={`toast-${toast.id}`}
      className={`toast-item toast-${toast.tone}`}
      style={{ insetBlockEnd: `${1.25 + index * 4.75}rem` }}
      onFocus={() => {
        pausedRef.current = true;
      }}
      onBlur={() => {
        pausedRef.current = false;
      }}
      {...({ popover: 'manual' } as Record<string, string>)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem' }}>
        <Icon
          size={18}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            marginTop: '2px',
            color:
              toast.tone === 'success'
                ? 'var(--status-online)'
                : toast.tone === 'error'
                  ? 'var(--status-danger)'
                  : toast.tone === 'warn'
                    ? 'var(--status-warn)'
                    : 'var(--accent-bright)',
          }}
        />
        <span style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{toast.text}</span>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        {...({ popovertarget: `toast-${toast.id}`, popovertargetaction: 'hide' } as Record<string, string>)}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  const liveRef = useRef<HTMLDivElement>(null);
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const t of toasts) {
      if (!announcedRef.current.has(t.id)) {
        announcedRef.current.add(t.id);
        announceToScreenReader(t.text, liveRef.current);
      }
    }
  }, [toasts]);

  return (
    <>
      {/* Pre-populated hidden live region fallback for browsers without ariaNotify() */}
      <p className="visually-hidden">Screen reader notifications</p>
      <div ref={liveRef} aria-live="assertive" className="visually-hidden" />
      <div role="region" aria-label="Notifications" className="toast-region">
        {toasts.map((toast, idx) => (
          <ToastPopoverItem key={toast.id} toast={toast} index={idx} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  );
}
