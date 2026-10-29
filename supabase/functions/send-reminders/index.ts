// send-reminders — Supabase Edge Function (Deno).
//
// Two ways in:
//  * Hourly cron (pg_cron + pg_net, see supabase/cron_send_reminders.sql) with header
//    `x-cron-secret: <CRON_SECRET>`: claims due reminders, sends one email per company with
//    Resend, records the outcome.
//  * "Send test email" in the app (signed-in user's JWT): emails that user a preview of the
//    reminders scheduled for their company.
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, REMINDER_FROM, APP_URL, CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deploy with --no-verify-jwt: this function checks the cron secret or the user's token itself.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { timingSafeEqual } from 'node:crypto';
import { buildEmail, type Group, type Item } from './email.ts';
import { resendSender, runCron, sendAlerts, supabaseDb, type Sender } from './cron.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}. Set it with: supabase secrets set ${name}=...`);
  return v;
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The next reminders scheduled for one company, shaped like a claimed group (for the test email).
async function upcomingFor(sb: SupabaseClient, companyId: string): Promise<Item[]> {
  const { data, error } = await sb
    .from('reminders')
    .select(
      'id, kind, remind_at, tender:tenders(id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, submission_method, status), document:company_documents(id, doc_type, label, file_name, expires_on)',
    )
    .eq('company_id', companyId)
    .is('sent_at', null)
    .order('remind_at')
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...r,
    tender: r.tender ? { ...r.tender, open_items: -1, open_mandatory: -1, to_review: -1 } : null,
  })) as Item[];
}

async function sendTest(req: Request, sb: SupabaseClient, send: Sender, appUrl: string) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const { data: auth, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

  const { data: me } = await sb.from('users').select('email, name, company_id, companies(name)').eq('id', auth.user.id).maybeSingle();
  if (!me) return json({ error: 'Finish setting up your company first.' }, 400);
  if (!me.email) return json({ error: 'Your account has no email address.' }, 400);

  const items = await upcomingFor(sb, me.company_id);
  const group: Group = { company_id: me.company_id, company_name: (me as any).companies?.name ?? 'your company', recipients: [{ email: me.email, name: me.name }], items };
  const email = buildEmail(group, appUrl, new Date(), { test: true })!;
  try {
    await send([me.email], email, `test-${auth.user.id}-${Date.now()}`);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
  return json({ sent_to: me.email, scheduled: items.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const send = resendSender(env('RESEND_API_KEY'), env('REMINDER_FROM'));
    const appUrl = env('APP_URL');
    const secret = req.headers.get('x-cron-secret');
    if (secret !== null) {
      if (!sameSecret(secret, env('CRON_SECRET'))) return json({ error: 'Forbidden' }, 403);
      const db = supabaseDb(sb);
      const summary: Record<string, unknown> = await runCron(db, send, appUrl);
      try {
        summary.admin = await sendAlerts(db, send, Deno.env.get('ADMIN_EMAIL'), appUrl);
      } catch (e) {
        console.error('admin alert failed', e);
        summary.admin = { error: e instanceof Error ? e.message : String(e) };
      }
      if ((summary.errors as string[]).length) console.error('send-reminders errors', summary.errors);
      return json(summary);
    }
    return await sendTest(req, sb, send, appUrl);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
