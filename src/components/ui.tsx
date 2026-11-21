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

// Placeholder rows while a list loads: the layout settles before the data arrives.
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          <span className="sk" style={{ width: `${46 - (i % 3) * 8}%` }} />
          <span className="sk short" />
        </div>
      ))}
    </div>
  );
}

// Full-screen loading mark, the same as the one in index.html, so start-up is one continuous screen.
export function BootMark({ label = 'Loading', text }: { label?: string; text?: string }) {
  return (
    <div className="boot" role="status" aria-label={label}>
      <div className="boot-inner">
        <img src="/favicon.svg" alt="" />
        {text && <p className="boot-text">{text}</p>}
      </div>
    </div>
  );
}

// Browser tab title: "<page> · Tender Intelligence".
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Tender Intelligence` : 'Tender Intelligence · Mdaka Tech';
  }, [title]);
}
