// Sending logic for send-reminders, kept apart from the HTTP handler so it can be tested.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildEmail, type Email, type Group } from './email.ts';

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
}

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
  };
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

