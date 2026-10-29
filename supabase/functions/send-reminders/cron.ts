// Sending logic for send-reminders, kept apart from the HTTP handler so it can be tested.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildAlertEmail, buildEmail, type Alert, type Email, type Group } from './email.ts';

export type Sender = (to: string[], email: Email, idempotencyKey: string) => Promise<void>;

export function resendSender(apiKey: string, from: string): Sender {
  return async (to, email, idempotencyKey) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from, to, subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  };
}

async function idempotencyKey(ids: string[]): Promise<string> {
  const data = new TextEncoder().encode([...ids].sort().join(','));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return 'reminders-' + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

export interface Db {
  claim(): Promise<Group[]>;
  finish(ids: string[], error: string | null): Promise<void>;
  alerts(): Promise<Alert[]>;
  markAlerts(ids: number[]): Promise<void>;
  cleanupBatch(): Promise<CleanupItem[]>;
  cleanupDone(done: number[], failed: number[], error: string | null): Promise<void>;
}

export interface CleanupItem {
  id: number;
  bucket: 'tenders' | 'vault';
  path: string;
}

// Removes files from a storage bucket. Files that are already gone are not an error.
export type Remover = (bucket: string, paths: string[]) => Promise<void>;

export function supabaseDb(sb: SupabaseClient): Db {
  return {
    async claim() {
      const { data, error } = await sb.rpc('claim_due_reminders', { p_limit: 200 });
      if (error) throw new Error(`claim_due_reminders: ${error.message}`);
      return (data ?? []) as Group[];
    },
    async finish(ids, err) {
      const { error } = await sb.rpc('finish_reminders', { p_ids: ids, p_error: err });
      if (error) throw new Error(`finish_reminders: ${error.message}`);
    },
    async alerts() {
      const { data, error } = await sb.rpc('pending_system_alerts');
      if (error) throw new Error(`pending_system_alerts: ${error.message}`);
      return (data ?? []) as Alert[];
    },
    async markAlerts(ids) {
      const { error } = await sb.rpc('mark_system_alerts_notified', { p_ids: ids });
      if (error) throw new Error(`mark_system_alerts_notified: ${error.message}`);
    },
    async cleanupBatch() {
      const { data, error } = await sb.rpc('claim_storage_cleanup', { p_limit: 500 });
      if (error) throw new Error(`claim_storage_cleanup: ${error.message}`);
      return (data ?? []) as CleanupItem[];
    },
    async cleanupDone(done, failed, err) {
      const { error } = await sb.rpc('finish_storage_cleanup', { p_done: done, p_failed: failed, p_error: err });
      if (error) throw new Error(`finish_storage_cleanup: ${error.message}`);
    },
  };
}

export function storageRemover(sb: SupabaseClient): Remover {
  return async (bucket, paths) => {
    const { error } = await sb.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Storage remove (${bucket}): ${error.message}`);
  };
}

// Deletes the stored PDFs of rows that were deleted (queued by a database trigger, migration 0006).
export async function cleanStorage(db: Db, remove: Remover) {
  const summary = { removed: 0, failed: 0 };
  for (let round = 0; round < 10; round++) {
    const batch = await db.cleanupBatch();
    if (!batch.length) break;
    const done: number[] = [];
    const failed: number[] = [];
    let lastError: string | null = null;
    for (const bucket of ['tenders', 'vault'] as const) {
      const items = batch.filter((i) => i.bucket === bucket);
      for (let k = 0; k < items.length; k += 100) {
        const chunk = items.slice(k, k + 100);
        try {
          await remove(bucket, chunk.map((i) => i.path));
          done.push(...chunk.map((i) => i.id));
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          failed.push(...chunk.map((i) => i.id));
        }
      }
    }
    await db.cleanupDone(done, failed, lastError);
    summary.removed += done.length;
    summary.failed += failed.length;
    if (failed.length || batch.length < 500) break; // don't spin on a failing bucket; next hour retries
  }
  return summary;
}

// Emails the admin about problems users can't fix (e.g. the AI account ran out of credit).
// Alerts stay pending, and are retried next hour, until an email goes out.
export async function sendAlerts(db: Db, send: Sender, adminEmail: string | undefined, appUrl: string) {
  if (!adminEmail) return { alerts: 0, skipped: 'ADMIN_EMAIL not set' };
  const alerts = await db.alerts();
  if (!alerts.length) return { alerts: 0 };
  await send([adminEmail], buildAlertEmail(alerts, appUrl), `alerts-${alerts.map((a) => a.id).join('-')}`);
  await db.markAlerts(alerts.map((a) => a.id));
  return { alerts: alerts.length };
}

// One pass over everything that is due. Each company's email succeeds or fails on its own.
export async function runCron(db: Db, send: Sender, appUrl: string, now = new Date()) {
  const summary = { companies: 0, emails: 0, reminders: 0, failed: 0, errors: [] as string[] };
  for (let round = 0; round < 5; round++) {
    const groups = await db.claim();
    if (!groups.length) break;
    for (const g of groups) {
      summary.companies++;
      const ids = g.items.map((i) => i.id);
      const to = g.recipients.map((r) => r.email).filter(Boolean);
      const email = buildEmail(g, appUrl, now);
      try {
        if (!email) {
          await db.finish(ids, null); // nothing describable left (e.g. dates cleared): nothing to send
          continue;
        }
        if (!to.length) throw new Error('No recipients');
        await send(to, email, await idempotencyKey(ids));
        await db.finish(ids, null);
        summary.emails++;
        summary.reminders += ids.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.failed += ids.length;
        summary.errors.push(`${g.company_name}: ${msg}`);
        await db.finish(ids, msg).catch(() => {});
      }
    }
    if (groups.reduce((n, g) => n + g.items.length, 0) < 200) break;
  }
  return summary;
}

