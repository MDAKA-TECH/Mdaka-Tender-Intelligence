import { daysUntil } from './dates';
import type { DocType } from './types';

export interface VaultDoc {
  id: string;
  doc_type: DocType;
  label: string | null;
  file_name: string;
  expires_on: string | null;
  created_at: string;
}

export type VaultState = 'ready' | 'on_file' | 'expires_before_closing' | 'expired' | 'missing';

export interface VaultMatch {
  state: VaultState;
  doc: VaultDoc | null;
  label: string;
  tone: 'ok' | 'warn' | 'crit';
}

// closing_at is a UTC timestamp; compare with the calendar day the user sees.
function localDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The newest vault document of a type is the one that counts (older versions are history).
export function matchVault(docType: DocType, vault: VaultDoc[], closingAt: string | null, today = new Date()): VaultMatch {
  const doc = vault
    .filter((d) => d.doc_type === docType)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  if (!doc) return { state: 'missing', doc: null, label: 'Missing from vault', tone: 'crit' };
  if (!doc.expires_on) return { state: 'on_file', doc, label: 'In vault', tone: 'ok' };
  if (daysUntil(doc.expires_on, today) < 0) return { state: 'expired', doc, label: 'Expired', tone: 'crit' };
  // A document must still be valid on the closing date, not just today.
  if (closingAt && doc.expires_on < localDate(closingAt)) {
    return { state: 'expires_before_closing', doc, label: 'Expires before closing', tone: 'warn' };
  }
  return { state: 'ready', doc, label: 'Ready', tone: 'ok' };
}
