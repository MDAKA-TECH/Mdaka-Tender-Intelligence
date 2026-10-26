import { useMemo } from 'react';
import { docTypeInfo, type AiField, type Confidence, type Requirement, type TenderAi, type TenderFile } from '../lib/types';
import { fmtDate, fmtDateTime } from '../lib/dates';

// Shows what the AI found for a tender. Everything here is UNCONFIRMED: the review screen
// (week 4) is where a person confirms or corrects each item against its source page.

const FIELD_LABEL: [string, string][] = [
  ['closing', 'Closing'],
  ['briefing', 'Briefing session'],
  ['submission', 'Submission'],
  ['reference_no', 'Reference number'],
  ['issuing_entity', 'Issued by'],
  ['description', 'Description'],
  ['evaluation', 'Evaluation'],
  ['validity_days', 'Bid validity'],
  ['contact', 'Contact'],
  ['query_deadline', 'Last day for questions'],
  ['pricing_format', 'Pricing format'],
];

const METHOD: Record<string, string> = {
  email: 'Email', etenders_upload: 'eTenders upload', tender_box: 'Tender box', hand_delivery: 'Hand delivery',
  courier: 'Courier', online_portal: 'Online portal', other: 'Other',
};

type V = Record<string, unknown>;

function fieldValue(name: string, f: AiField): string {
  if (f.status !== 'found' || f.value == null) return '';
  const v = f.value as V;
  switch (name) {
    case 'closing':
      return `${fmtDate(String(v.date))}${v.time ? ` at ${v.time}` : ', time not stated'}`;
    case 'briefing': {
      if (!v.date) return v.compulsory === false ? 'Not compulsory / not applicable' : 'Mentioned, no date given';
      const parts = [v.compulsory ? 'Compulsory' : v.compulsory === false ? 'Optional' : 'Briefing', fmtDate(String(v.date))];
      if (v.time) parts.push(`at ${v.time}`);
      return parts.join(', ') + (v.venue ? ` · ${v.venue}` : '');
    }
    case 'submission':
      return `${METHOD[String(v.method)] ?? String(v.method)}: ${v.address}`;
    case 'evaluation':
      return [v.preference_system && `${v.preference_system} preference points`, v.functionality_threshold != null && `functionality minimum ${v.functionality_threshold}`]
        .filter(Boolean).join(', ') || 'Stated (see source)';
    case 'validity_days':
      return `${f.value} days`;
    case 'contact':
      return [v.name, v.email, v.phone].filter(Boolean).join(' · ');
    case 'query_deadline':
      return fmtDate(String(f.value));
    default:
      return String(f.value);
  }
}

function ConfidencePill({ c, keyword, unverified }: { c: Confidence | null; keyword?: boolean; unverified?: boolean | null }) {
  if (keyword) return <span className="pill warn" title="The AI didn't list this; a keyword check found it in the text.">Keyword check</span>;
  if (unverified) return <span className="pill crit" title="The quote wasn't found in the document.">Quote not found</span>;
  if (!c) return null;
  return <span className={`pill ${c === 'high' ? 'ok' : c === 'medium' ? 'accent' : 'warn'}`}>{c === 'high' ? 'High' : c === 'medium' ? 'Medium' : 'Low'}</span>;
}

export default function AiPanel({
  ai, reqs, files, onRun, onOpenSource,
}: {
  ai: TenderAi;
  reqs: Requirement[] | null;
  files: TenderFile[];
  onRun: () => void;
  onOpenSource: (fileId: string | null, page: number | null, quote: string | null) => void;
}) {
  const done = files.filter((f) => f.status === 'done');
  const filesPending = files.some((f) => f.status === 'queued' || f.status === 'extracting');
  const stale = useMemo(() => {
    if (ai.ai_status !== 'done') return false;
    const now = [...done.map((f) => f.id)].sort().join();
    return now !== [...ai.ai_file_ids].sort().join();
  }, [ai, done]);

  const fileIdByNumber = (n: number | null) => (n ? ai.ai_fields?.files.find((f) => f.n === n)?.id ?? null : null);
  const fileNumber = (id: string | null) => ai.ai_fields?.files.find((f) => f.id === id)?.n;
  const multi = (ai.ai_fields?.files.length ?? 0) > 1;
  const where = (fileId: string | null, page: number | null) =>
    page ? `${multi && fileNumber(fileId) ? `File ${fileNumber(fileId)}, ` : ''}p. ${page}` : '';

  const docs = (reqs ?? []).filter((r) => r.kind !== 'disqualifier' && r.kind !== 'special');
  const disq = (reqs ?? []).filter((r) => r.kind === 'disqualifier');
  const special = (reqs ?? []).filter((r) => r.kind === 'special');
  const toCheck = (reqs ?? []).filter((r) => r.confidence === 'low' || r.added_by === 'keyword_check' || r.verified === false).length;

  const busy = ai.ai_status === 'queued' || ai.ai_status === 'running';

  return (
    <section className="panel" aria-labelledby="ai-head">
      <div className="panel-head">
        <div className="ai-title">
          <h2 id="ai-head">AI extraction</h2>
          {ai.ai_status === 'done' && <span className="pill accent">Unconfirmed</span>}
          {busy && <span className="pill accent">{ai.ai_status === 'running' ? 'Reading with AI…' : 'Queued'}</span>}
          {ai.ai_status === 'failed' && <span className="pill crit">Failed</span>}
        </div>
        {ai.ai_status !== 'none' || done.length > 0 ? (
          <button className={ai.ai_status === 'none' ? 'btn primary' : 'btn'} onClick={onRun} disabled={busy || filesPending || done.length === 0}>
            {ai.ai_status === 'none' ? 'Run AI extraction' : 'Re-run'}
          </button>
        ) : null}
      </div>

      <div className="panel-body ai-body">
        {ai.ai_status === 'none' && (
          <p className="muted" style={{ margin: 0 }}>
            {filesPending ? 'Starts automatically once every PDF has been read.' : done.length ? 'Not run yet.' : 'Add the tender PDFs first.'}
          </p>
        )}
        {busy && (
          <p className="muted" style={{ margin: 0 }}>
            {filesPending ? 'Waiting for the PDFs to finish reading. ' : ''}
            The worker reads the whole pack and lists the deadlines, documents and disqualification rules. This usually takes under a minute.
            <WorkerHint ai={ai} />
          </p>
        )}
        {ai.ai_status === 'failed' && (
          <div className="callout crit">
            <b>AI extraction didn't finish</b>
            {ai.ai_error ?? 'Unknown error.'} {ai.ai_error && /rate limit/i.test(ai.ai_error) ? 'The free tier allows only a few requests; try again later.' : ''}
          </div>
        )}

        {ai.ai_status === 'done' && ai.ai_fields && (
          <>
            <div className="callout warn">
              <b>Check before relying on this</b>
              Every item links to the page it came from. {toCheck > 0 ? `${toCheck} item${toCheck === 1 ? '' : 's'} need${toCheck === 1 ? 's' : ''} a closer look (low confidence, keyword check or quote not found). ` : ''}
              Confirming and editing items arrives with the review screen.
            </div>
            {stale && (
              <div className="callout">
                <b>The files changed since this run</b>
                Re-run to include the PDFs added or re-read since {fmtDateTime(ai.ai_extracted_at!)}.
              </div>
            )}

            <h3 className="ai-sub">Key facts</h3>
            <div className="table-wrap">
              <table className="ai-table">
                <tbody>
                  {FIELD_LABEL.map(([name, label]) => {
                    const f = ai.ai_fields!.fields[name];
                    if (!f) return null;
                    const fid = fileIdByNumber(f.file);
                    return (
                      <tr key={name}>
                        <th scope="row">{label}</th>
                        <td>{f.status === 'found' ? fieldValue(name, f) : <span className="muted">Not stated</span>}</td>
                        <td className="src">
                          {f.status === 'found' && f.page && (
                            <button className="btn ghost" onClick={() => onOpenSource(fid, f.page, f.quote)} title={f.quote ?? ''}>
                              {where(fid, f.page)}
                            </button>
                          )}
                        </td>
                        <td className="conf">{f.status === 'found' && <ConfidencePill c={f.confidence} unverified={f.verified === false} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h3 className="ai-sub">Documents to submit <span className="muted small">({docs.length}, {docs.filter((d) => d.mandatory).length} mandatory)</span></h3>
            <ReqList items={docs} where={where} onOpenSource={onOpenSource} showVault />

            <h3 className="ai-sub">Disqualification conditions <span className="muted small">({disq.length})</span></h3>
            <ReqList items={disq} where={where} onOpenSource={onOpenSource} />

            {special.length > 0 && (
              <>
                <h3 className="ai-sub">Other requirements <span className="muted small">({special.length})</span></h3>
                <ReqList items={special} where={where} onOpenSource={onOpenSource} />
              </>
            )}

            <p className="small muted" style={{ margin: 0 }}>
              {ai.ai_model} · {fmtDateTime(ai.ai_extracted_at!)} · {ai.ai_fields.seconds}s
              {ai.ai_fields.tokens.input ? ` · ${ai.ai_fields.tokens.input.toLocaleString('en-ZA')} tokens in, ${(ai.ai_fields.tokens.output ?? 0).toLocaleString('en-ZA')} out` : ''}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function WorkerHint({ ai }: { ai: TenderAi }) {
  // Still queued (nobody has claimed it): the worker may not be running, or has no AI key.
  if (ai.ai_status !== 'queued') return null;
  return (
    <span>
      {' '}If it stays queued for a few minutes, check the worker is running and printed <span className="mono">AI extraction on</span> when it started.
    </span>
  );
}

function ReqList({
  items, where, onOpenSource, showVault,
}: {
  items: Requirement[];
  where: (fileId: string | null, page: number | null) => string;
  onOpenSource: (fileId: string | null, page: number | null, quote: string | null) => void;
  showVault?: boolean;
}) {
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>None found.</p>;
  return (
    <ul className="req-list">
      {items.map((r) => (
        <li key={r.id}>
          <div className="what">
            <span className="req-name">
              {r.description}
              {r.mandatory && r.kind !== 'disqualifier' && r.kind !== 'special' && <span className="req-tag">Mandatory</span>}
              {showVault && r.doc_type && <span className="req-tag vault">Vault: {docTypeInfo(r.doc_type).name}</span>}
            </span>
            {r.conditions && <span className="small muted">{r.conditions}</span>}
          </div>
          <div className="req-meta">
            {r.source_page && (
              <button className="btn ghost" onClick={() => onOpenSource(r.source_file_id, r.source_page, r.quote)} title={r.quote ?? ''}>
                {where(r.source_file_id, r.source_page)}
              </button>
            )}
            <ConfidencePill c={r.confidence} keyword={r.added_by === 'keyword_check'} unverified={r.verified === false} />
          </div>
        </li>
      ))}
    </ul>
  );
}
