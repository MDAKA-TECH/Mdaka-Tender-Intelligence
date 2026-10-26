// Builds the reminder emails. Pure functions (no network), so they can be unit-tested with `deno test`.

export interface TenderInfo {
  id: string;
  reference_no: string | null;
  entity: string | null;
  description: string | null;
  closing_at: string | null;
  briefing_at: string | null;
  briefing_compulsory: boolean | null;
  submission_method: string | null;
  status: string;
  open_items: number;
  open_mandatory: number;
  to_review: number;
}

export interface DocInfo {
  id: string;
  doc_type: string;
  label: string | null;
  file_name: string;
  expires_on: string; // YYYY-MM-DD
}

export interface Item {
  id: string;
  kind: 'closing' | 'briefing' | 'doc_expiry' | 'query_deadline';
  remind_at: string;
  tender: TenderInfo | null;
  document: DocInfo | null;
}

export interface Group {
  company_id: string;
  company_name: string;
  recipients: { email: string; name: string }[];
  items: Item[];
}

export interface Email {
  subject: string;
  html: string;
  text: string;
}

const TZ = 'Africa/Johannesburg';

export const DOC_NAMES: Record<string, string> = {
  tax_compliance: 'Tax compliance status (TCS PIN)',
  csd_report: 'CSD registration report',
  bbbee: 'B-BBEE certificate or sworn affidavit',
  cipc_registration: 'CIPC company registration',
  director_ids: "Certified copies of directors' IDs",
  bank_letter: 'Bank confirmation letter',
  coid: 'COID letter of good standing',
};

const docName = (d: DocInfo) => (d.doc_type === 'other' ? d.label || d.file_name : DOC_NAMES[d.doc_type] ?? d.doc_type);
const tenderName = (t: TenderInfo) => t.reference_no || t.description || 'Untitled tender';

// Calendar date in SAST, as YYYY-MM-DD.
function sastDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / 86_400_000);
}

// "today", "tomorrow", "in 3 days"
export function whenWord(target: string, now: Date): string {
  const day = target.length === 10 ? target : sastDay(new Date(target));
  const n = dayDiff(sastDay(now), day);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function fmtDate(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(day + 'T00:00:00Z'));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface Line {
  headline: string; // plain text; the bold part is wrapped in **…**
  details: string[];
  link: { label: string; url: string };
  short: string; // for the subject line
}

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

function checklistLine(t: TenderInfo): string | null {
  if (t.open_items < 0) return null; // not known (test email)
  const parts: string[] = [];
  if (t.to_review > 0) parts.push(`${plural(t.to_review, 'item')} not reviewed yet`);
  if (t.open_items > 0) parts.push(`${plural(t.open_items, 'document')} still to prepare${t.open_mandatory ? ` (${t.open_mandatory} mandatory)` : ''}`);
  if (!parts.length) return 'Every confirmed checklist item is ticked.';
  return 'Checklist: ' + parts.join(', ') + '.';
}

export function describe(item: Item, appUrl: string, now: Date): Line | null {
  const base = appUrl.replace(/\/+$/, '');
  if ((item.kind === 'closing' || item.kind === 'briefing') && item.tender) {
    const t = item.tender;
    const name = tenderName(t);
    const who = [t.entity, t.reference_no ? t.description : null].filter(Boolean).join(' · ');
    const link = { label: 'Open the tender', url: `${base}/#/tenders/${t.id}` };
    if (item.kind === 'closing' && t.closing_at) {
      const when = whenWord(t.closing_at, now);
      const details = [who, checklistLine(t), t.submission_method ? `Submission: ${t.submission_method}` : null].filter(Boolean) as string[];
      return { headline: `**${name}** closes ${when}, ${fmtDateTime(t.closing_at)}.`, details, link, short: `${name} closes ${when}` };
    }
    if (item.kind === 'briefing' && t.briefing_at) {
      const when = whenWord(t.briefing_at, now);
      const label = t.briefing_compulsory ? 'Compulsory briefing' : 'Briefing';
      const details = [who, t.briefing_compulsory ? 'Missing a compulsory briefing usually disqualifies the bid.' : 'Check the tender document to see whether it is compulsory.'].filter(Boolean) as string[];
      return { headline: `${label} for **${name}** ${when}, ${fmtDateTime(t.briefing_at)}.`, details, link, short: `${label.toLowerCase()} ${when} for ${name}` };
    }
    return null;
  }
  if (item.kind === 'doc_expiry' && item.document) {
    const d = item.document;
    const when = whenWord(d.expires_on, now);
    return {
      headline: `Your **${docName(d)}** expires ${when}, ${fmtDate(d.expires_on)}.`,
      details: ['Get a new one and upload it to the vault, so it is valid on your next closing date.'],
      link: { label: 'Open the vault', url: `${base}/#/vault` },
      short: `${docName(d)} expires ${when}`,
    };
  }
  return null;
}

const boldHtml = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const boldText = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

export function buildEmail(group: Group, appUrl: string, now = new Date(), opts: { test?: boolean } = {}): Email | null {
  const lines = group.items.map((i) => describe(i, appUrl, now)).filter(Boolean) as Line[];
  if (!lines.length && !opts.test) return null;

  const first = lines[0];
  let subject: string;
  if (opts.test) subject = 'Test email: Tender Intelligence reminders are working';
  else if (lines.length === 1) subject = cap(first.short);
  else subject = `${cap(first.short)} (+${lines.length - 1} more reminder${lines.length > 2 ? 's' : ''})`;

  const intro = opts.test
    ? lines.length
      ? `Reminders for ${group.company_name} will arrive like this. These are the next ones scheduled:`
      : `Reminders for ${group.company_name} will arrive at this address. Nothing is scheduled yet: reminders are set when a tender that is Reviewing or Preparing has a closing date or briefing, and when a vault document has an expiry date.`
    : `Reminders for ${group.company_name}:`;
  const footer = `You get these emails because reminders are on for your account in Tender Intelligence. Turn them off under Company profile. Always check the tender document itself for the exact requirements and deadlines.`;

  const text = [
    intro,
    '',
    ...lines.flatMap((l) => [`- ${boldText(l.headline)}`, ...l.details.map((d) => `  ${d}`), `  ${l.link.label}: ${l.link.url}`, '']),
    '--',
    footer,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f2">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#18201d;font-size:15px;line-height:1.5">
<p style="margin:0 0 4px;font-size:13px;color:#5d6b66">Tender Intelligence</p>
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
${lines
  .map(
    (l) => `<div style="background:#ffffff;border:1px solid #dfe3e1;border-radius:8px;padding:14px 16px;margin:0 0 12px">
<p style="margin:0 0 6px">${boldHtml(l.headline)}</p>
${l.details.map((d) => `<p style="margin:0 0 4px;font-size:14px;color:#3d4844">${escapeHtml(d)}</p>`).join('\n')}
<p style="margin:10px 0 0"><a href="${escapeHtml(l.link.url)}" style="color:#0e6b55;font-weight:600">${escapeHtml(l.link.label)}</a></p>
</div>`,
  )
  .join('\n')}
<p style="margin:20px 0 0;font-size:12px;color:#5d6b66">${escapeHtml(footer)}</p>
</div></body></html>`;

  return { subject, html, text };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
