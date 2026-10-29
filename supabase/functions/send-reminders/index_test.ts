import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
const assertStringIncludes = (s: string, part: string) => assert(s.includes(part), `expected to include: ${part}\n---\n${s}`);
import { buildEmail, whenWord, type Group } from './email.ts';
import { cleanStorage, runCron, sendAlerts, type CleanupItem, type Db, type Sender } from './cron.ts';
import { buildAlertEmail } from './email.ts';

const NOW = new Date('2026-10-26T06:05:00Z'); // Mon 26 Oct 08:05 SAST

const tender = {
  id: 't1', reference_no: 'RFQ 906/2026', entity: 'Parliament of RSA', description: 'Data analyst <services>',
  closing_at: '2026-10-28T09:00:00Z', briefing_at: '2026-10-27T08:00:00Z', briefing_compulsory: true,
  submission_method: 'Email to tenders@parliament.gov.za', status: 'preparing', open_items: 3, open_mandatory: 2, to_review: 1,
};
const group = (items: Group['items']): Group => ({ company_id: 'c1', company_name: 'Mdaka Advanced Technologies', recipients: [{ email: 'a@x.test', name: 'A' }], items });

Deno.test('relative days use SAST calendar days', () => {
  assertEquals(whenWord('2026-10-26T21:30:00Z', NOW), 'today'); // 23:30 SAST Mon
  assertEquals(whenWord('2026-10-26T22:30:00Z', NOW), 'tomorrow'); // 00:30 SAST Tue
  assertEquals(whenWord('2026-10-26T10:00:00Z', NOW), 'today');
  assertEquals(whenWord('2026-11-02', NOW), 'in 7 days');
});

Deno.test('single closing reminder', () => {
  const e = buildEmail(group([{ id: 'r1', kind: 'closing', remind_at: NOW.toISOString(), tender, document: null }]), 'https://app.test/', NOW)!;
  assertEquals(e.subject, 'RFQ 906/2026 closes in 2 days');
  assertStringIncludes(e.text, 'closes in 2 days, Wed, 28 Oct 2026, 11:00');
  assertStringIncludes(e.text, '1 item not reviewed yet, 3 documents still to prepare (2 mandatory)');
  assertStringIncludes(e.text, 'https://app.test/#/tenders/t1');
  assertStringIncludes(e.html, 'Data analyst &lt;services&gt;');
  assert(!e.html.includes('<services>'));
});

Deno.test('digest of briefing + expiry', () => {
  const e = buildEmail(group([
    { id: 'r1', kind: 'briefing', remind_at: NOW.toISOString(), tender, document: null },
    { id: 'r2', kind: 'doc_expiry', remind_at: NOW.toISOString(), tender: null, document: { id: 'd1', doc_type: 'tax_compliance', label: null, file_name: 'tcs.pdf', expires_on: '2026-11-02' } },
  ]), 'https://app.test', NOW)!;
  assertEquals(e.subject, 'Compulsory briefing tomorrow for RFQ 906/2026 (+1 more reminder)');
  assertStringIncludes(e.text, 'Tax compliance status (TCS PIN) expires in 7 days, Mon, 2 Nov 2026');
  assertStringIncludes(e.text, 'https://app.test/#/vault');
});

Deno.test('test email with nothing scheduled', () => {
  const e = buildEmail(group([]), 'https://app.test', NOW, { test: true })!;
  assertStringIncludes(e.subject, 'Test email');
  assertStringIncludes(e.text, 'Nothing is scheduled yet');
});

function fakeDb(groups: Group[]) {
  const finished: [string[], string | null][] = [];
  let given = false;
  const db: Db = {
    claim: async () => (given ? [] : ((given = true), groups)),
    finish: async (ids, err) => { finished.push([ids, err]); },
    alerts: async () => [],
    markAlerts: async () => {},
    cleanupBatch: async () => [],
    cleanupDone: async () => {},
  };
  return { db, finished };
}

Deno.test('cron: sends per company, records failures separately', async () => {
  const ok = group([{ id: 'r1', kind: 'closing', remind_at: '', tender, document: null }]);
  const bad = { ...group([{ id: 'r2', kind: 'closing', remind_at: '', tender, document: null }]), company_id: 'c2', company_name: 'Bad Co', recipients: [{ email: 'bad@x.test', name: 'B' }] };
  const { db, finished } = fakeDb([ok, bad]);
  const sent: string[][] = [];
  const send: Sender = async (to) => { if (to[0] === 'bad@x.test') throw new Error('Resend 403: domain not verified'); sent.push(to); };
  const s = await runCron(db, send, 'https://app.test', NOW);
  assertEquals(sent, [['a@x.test']]);
  assertEquals(finished, [[['r1'], null], [['r2'], 'Resend 403: domain not verified']]);
  assertEquals(s.emails, 1);
  assertEquals(s.failed, 1);
});

Deno.test('cron: nothing due', async () => {
  const { db } = fakeDb([]);
  const s = await runCron(db, async () => { throw new Error('should not send'); }, 'https://app.test', NOW);
  assertEquals(s.emails, 0);
});

Deno.test('admin alert: emailed once, then marked', async () => {
  const marked: number[][] = [];
  const db: Db = {
    claim: async () => [], finish: async () => {},
    alerts: async () => [{ id: 7, kind: 'ai_account', message: '429 from model API (account/quota problem): insufficient_quota', created_at: '2026-10-29T08:00:00Z' }],
    markAlerts: async (ids) => { marked.push(ids); },
    cleanupBatch: async () => [], cleanupDone: async () => {},
  };
  const sent: string[] = [];
  const r = await sendAlerts(db, async (to, e) => { sent.push(to[0] + ' | ' + e.subject); }, 'admin@x.test', 'https://app.test');
  assertEquals(r, { alerts: 1 });
  assertEquals(sent, ['admin@x.test | Tender Intelligence: AI extraction is paused']);
  assertEquals(marked, [[7]]);
  assertEquals(await sendAlerts(db, async () => {}, undefined, 'x'), { alerts: 0, skipped: 'ADMIN_EMAIL not set' });
});

Deno.test('admin alert: failed send leaves it pending', async () => {
  let marked = false;
  const db: Db = { claim: async () => [], finish: async () => {}, alerts: async () => [{ id: 1, kind: 'ai_account', message: 'x', created_at: '2026-10-29T08:00:00Z' }], markAlerts: async () => { marked = true; }, cleanupBatch: async () => [], cleanupDone: async () => {} };
  let threw = false;
  try { await sendAlerts(db, async () => { throw new Error('Resend 500'); }, 'a@x.test', 'x'); } catch { threw = true; }
  assert(threw && !marked);
  assertStringIncludes(buildAlertEmail([{ id: 1, kind: 'ai_account', message: '<b>', created_at: '2026-10-29T08:00:00Z' }], 'x').html, '&lt;b&gt;');
});

Deno.test('storage cleanup: removes queued files per bucket, keeps failures for next run', async () => {
  const queue: CleanupItem[] = [
    { id: 1, bucket: 'tenders', path: 'c/t/a.pdf' }, { id: 2, bucket: 'tenders', path: 'c/t/b.pdf' }, { id: 3, bucket: 'vault', path: 'c/csd.pdf' },
  ];
  const finished: [number[], number[], string | null][] = [];
  let served = false;
  const db = {
    claim: async () => [], finish: async () => {}, alerts: async () => [], markAlerts: async () => {},
    cleanupBatch: async () => (served ? [] : ((served = true), queue)),
    cleanupDone: async (d: number[], f: number[], e: string | null) => { finished.push([d, f, e]); },
  } as Db;
  const calls: string[] = [];
  const s = await cleanStorage(db, async (bucket, paths) => {
    calls.push(`${bucket}:${paths.join(',')}`);
    if (bucket === 'vault') throw new Error('Storage 500');
  });
  assertEquals(calls, ['tenders:c/t/a.pdf,c/t/b.pdf', 'vault:c/csd.pdf']);
  assertEquals(finished, [[[1, 2], [3], 'Storage 500']]);
  assertEquals(s, { removed: 2, failed: 1 });
});
