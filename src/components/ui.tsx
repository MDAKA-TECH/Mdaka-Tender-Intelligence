import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { expiryState, daysUntil } from '../lib/dates';

export const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Vault states are printed as divider tabs: emerald ready, marigold expiring, vermilion expired/missing.
export function ExpiryPill({ expires_on }: { expires_on: string | null }) {
  const s = expiryState(expires_on);
  if (s === 'no_expiry') return <span className="stab" data-tone="ready">On file</span>;
  const n = daysUntil(expires_on!);
  if (s === 'expired') return <span className="stab" data-tone="crit">Expired {Math.abs(n) === 0 ? 'today' : `${Math.abs(n)} d ago`}</span>;
  if (s === 'expiring') return <span className="stab" data-tone="review">{n === 0 ? 'Expires today' : `Expires in ${n} d`}</span>;
  return <span className="stab" data-tone="ready">Valid</span>;
}

export function MissingPill({ core }: { core: boolean }) {
  return core ? <span className="stab" data-tone="crit">Missing</span> : <span className="stab soft" data-tone="slate">Not uploaded</span>;
}
