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
