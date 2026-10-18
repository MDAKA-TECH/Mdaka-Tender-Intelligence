export const EXPIRING_DAYS = 30;

// Dates from Postgres `date` columns are plain 'YYYY-MM-DD'; compare them as local calendar days.
export function daysUntil(isoDate: string, today = new Date()): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86_400_000);
}

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'no_expiry';

export function expiryState(expires_on: string | null, today = new Date()): ExpiryState {
  if (!expires_on) return 'no_expiry';
  const n = daysUntil(expires_on, today);
  if (n < 0) return 'expired';
  if (n <= EXPIRING_DAYS) return 'expiring';
  return 'valid';
}

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const fmtSize = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// timestamptz <-> <input type="datetime-local"> in the browser's own time zone.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// "in 3 days", "today", "closed 2 days ago" for a timestamptz.
export function closingIn(iso: string, now = new Date()): { label: string; tone: 'ok' | 'warn' | 'crit' | 'plain' } {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms < 0) {
    const d = Math.floor(-ms / 86_400_000);
    return { label: d === 0 ? 'Closed today' : `Closed ${d} d ago`, tone: 'plain' };
  }
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return { label: `Closes in ${Math.max(1, Math.round(ms / 3_600_000))} h`, tone: 'crit' };
  return { label: `${days} d left`, tone: days <= 3 ? 'crit' : days <= 7 ? 'warn' : 'ok' };
}
