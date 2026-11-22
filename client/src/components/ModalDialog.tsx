import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  lightDismiss?: boolean;
}

/**
 * Native <dialog> modal following modern-web-guidance:
 * - Opened via showModal() (no manual role="dialog", aria-modal, focus trap, or body overflow lock)
 * - Resets dialog.returnValue = '' on close to prevent stale values
 * - Uses closedby="any" with bounding-box pointerdown/pointerup fallback when closedBy is unsupported
 */
export function ModalDialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  lightDismiss = true,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onCloseRef.current();
    };

    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss for browsers without native HTMLDialogElement.prototype.closedBy
    let cleanupLightDismiss: (() => void) | undefined;
    if (lightDismiss && !('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupLightDismiss?.();
    };
  }, [lightDismiss]);

  return (
    <dialog
      ref={dialogRef}
      className={`mc-dialog ${wide ? 'mc-dialog-wide' : ''}`}
      aria-labelledby={titleId}
      {...({ closedby: lightDismiss ? 'any' : 'closerequest' } as Record<string, string>)}
    >
      <div className="mc-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Close dialog"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="mc-dialog-body scroller">{children}</div>
      {footer && <div className="mc-dialog-footer">{footer}</div>}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {/* Put autofocus on the safe Cancel action in destructive confirmations */}
          <button type="button" className="btn" autoFocus onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{message}</p>
    </ModalDialog>
  );
}
