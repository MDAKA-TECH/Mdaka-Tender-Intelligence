import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';
import { DOC_TYPES, docTypeInfo, type AiField, type Confidence, type DocType, type Requirement, type RequirementKind, type Tender, type TenderAi, type TenderFile } from '../lib/types';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { FIELD_LABEL, KIND_LABEL, fieldValue } from '../lib/fields';
import { matchVault, type VaultDoc } from '../lib/vault';
import { Modal, useToast } from './ui';

// AI results → a person reviews each item → confirmed items become the checklist.
// Nothing reaches the checklist without a person confirming it.

export interface DetailsPrefill {
  reference_no?: string;
  entity?: string;
  description?: string;
  closing_local?: string;   // 'YYYY-MM-DDTHH:MM' for <input type="datetime-local">
  briefing_local?: string;
  briefing_compulsory?: boolean | null;
  notes: string[];
}

type SourceFn = (fileId: string | null, page: number | null, quote: string | null) => void;

const EDIT_KINDS: RequirementKind[] = ['document', 'form', 'certification', 'pricing', 'disqualifier', 'special'];
const isDoc = (r: Requirement) => r.kind !== 'disqualifier' && r.kind !== 'special';
type V = Record<string, unknown>;

// What the AI found, turned into values for the tender details form (which the person saves).
export function prefillFromAi(fields: Record<string, AiField>): DetailsPrefill {
  const out: DetailsPrefill = { notes: [] };
  const found = (k: string) => (fields[k]?.status === 'found' ? fields[k] : null);
  const ref = found('reference_no');
  if (ref) out.reference_no = String(ref.value);
  const ent = found('issuing_entity');
  if (ent) out.entity = String(ent.value);
  const desc = found('description');
  if (desc) out.description = String(desc.value);
  const closing = found('closing');
  if (closing) {
    const v = closing.value as V;
    if (v.time) out.closing_local = `${v.date}T${v.time}`;
    else out.notes.push(`The tender gives the closing date (${fmtDate(String(v.date))}) but no time. Enter the time yourself.`);
  }
  const brief = found('briefing');
  if (brief) {
    const v = brief.value as V;
    out.briefing_compulsory = (v.compulsory as boolean | null) ?? null;
    if (v.date && v.time) out.briefing_local = `${v.date}T${v.time}`;
    else if (v.date) out.notes.push(`Briefing on ${fmtDate(String(v.date))}, time not stated. Enter the time yourself.`);
  }
  return out;
}

function priority(r: Requirement): number {
  if (r.added_by === 'keyword_check' || r.verified === false || r.confidence === 'low') return 0;
  if (r.confidence === 'medium') return 1;
  return 2;
}

function ConfidencePill({ c, keyword, unverified }: { c: Confidence | null; keyword?: boolean; unverified?: boolean | null }) {
  if (keyword) return <span className="pill warn" title="The AI didn't list this; a keyword check found it in the text.">Keyword check</span>;
  if (unverified) return <span className="pill crit" title="The quote wasn't found in the document.">Quote not found</span>;
  if (!c) return null;
  return <span className={`pill ${c === 'high' ? 'ok' : c === 'medium' ? 'accent' : 'warn'}`}>{c === 'high' ? 'High' : c === 'medium' ? 'Medium' : 'Low'}</span>;
}

export default function ReviewPanel({
  tender, ai, reqs, files, vault, onRun, onChanged, onOpenSource, onFillDetails, onOpenVault,
}: {
  tender: Tender;
  ai: TenderAi;
  reqs: Requirement[];
  files: TenderFile[];
  vault: VaultDoc[];
  onRun: () => void;
  onChanged: () => void;
  onOpenSource: SourceFn;
  onFillDetails: (p: DetailsPrefill) => void;
  onOpenVault: () => void;
}) {
  const toast = useToast();
  const toReview = useMemo(
    () => reqs.filter((r) => !r.confirmed).sort((a, b) => priority(a) - priority(b) || a.sort_order - b.sort_order),
    [reqs],
  );
  const confirmed = reqs.filter((r) => r.confirmed && r.status !== 'not_applicable');
  const dismissed = reqs.filter((r) => r.confirmed && r.status === 'not_applicable');
  const checklistDocs = confirmed.filter(isDoc);
  const [tab, setTab] = useState<'review' | 'checklist'>(toReview.length || !confirmed.length ? 'review' : 'checklist');
  const [editing, setEditing] = useState<Requirement | 'new' | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // Once everything is reviewed, show the checklist.
  useEffect(() => {
    if (!toReview.length && confirmed.length) setTab('checklist');
  }, [toReview.length, confirmed.length]);

  const done = files.filter((f) => f.status === 'done');
  const filesPending = files.some((f) => f.status === 'queued' || f.status === 'extracting');
  const busy = ai.ai_status === 'queued' || ai.ai_status === 'running';
  const stale = ai.ai_status === 'done' && [...done.map((f) => f.id)].sort().join() !== [...ai.ai_file_ids].sort().join();

  const fileNumber = (id: string | null) => ai.ai_fields?.files.find((f) => f.id === id)?.n;
  const fileIdByNumber = (n: number | null) => (n ? ai.ai_fields?.files.find((f) => f.n === n)?.id ?? null : null);
  const multi = (ai.ai_fields?.files.length ?? 0) > 1;
  const where = (fileId: string | null, page: number | null) =>
    page ? `${multi && fileNumber(fileId) ? `File ${fileNumber(fileId)}, ` : ''}p. ${page}` : '';

  const update = async (ids: string[], patch: Partial<Requirement>, msg?: string) => {
    setBusyIds((s) => new Set([...s, ...ids]));
    const { error } = await supabase.from('requirements').update(patch).in('id', ids);
    setBusyIds((s) => new Set([...s].filter((x) => !ids.includes(x))));
    if (error) return toast(friendlyError(error));
    if (msg) toast(msg);
    onChanged();
  };

  const highConfidence = toReview.filter((r) => priority(r) === 2);

  return (
    <section className="panel" aria-labelledby="review-head">
      <div className="panel-head">
        <div className="ai-title">
          <h2 id="review-head">Requirements</h2>
          {busy && <span className="pill accent">{ai.ai_status === 'running' ? 'Reading with AI…' : 'AI queued'}</span>}
          {ai.ai_status === 'failed' && <span className="pill crit">AI failed</span>}
        </div>
        <div className="toolbar">
          {(ai.ai_status !== 'none' || done.length > 0) && (
            <button className="btn" onClick={onRun} disabled={busy || filesPending || done.length === 0}
              title={ai.ai_status === 'none' ? '' : 'Reads the pack again. Items you confirmed or marked not required are kept.'}>
              {ai.ai_status === 'none' ? 'Run AI extraction' : 'Re-run AI'}
            </button>
          )}
          <button className="btn" onClick={() => setEditing('new')}>Add item</button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Requirements">
        <button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
          Review {toReview.length > 0 && <span className="count">{toReview.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'checklist'} onClick={() => setTab('checklist')}>
          Checklist {checklistDocs.length > 0 && <span className="muted small">{checklistDocs.filter((r) => r.status === 'done').length}/{checklistDocs.length}</span>}
        </button>
      </div>

      <div className="panel-body ai-body">
        {ai.ai_status === 'none' && !reqs.length && (
          <p className="muted" style={{ margin: 0 }}>
            {filesPending ? 'AI extraction starts automatically once every PDF has been read.' : done.length ? 'Not run yet.' : 'Add the tender PDFs first.'}
          </p>
        )}
        {busy && (
          <p className="muted" style={{ margin: 0 }}>
            {filesPending ? 'Waiting for the PDFs to finish reading. ' : ''}
            The AI reads the whole pack and lists the deadlines, documents and disqualification rules, usually in under a minute.
            {ai.ai_status === 'queued' && <> If it stays queued, check the worker is running and printed <span className="mono">AI extraction on</span>.</>}
          </p>
        )}
        {ai.ai_status === 'failed' && (
          <div className="callout crit">
            <b>AI extraction didn't finish</b>
            {ai.ai_error ?? 'Unknown error.'} {ai.ai_error && /rate limit/i.test(ai.ai_error) ? 'The free tier allows only a few requests; try again later.' : ''}
          </div>
        )}
        {stale && (
          <div className="callout">
            <b>The files changed since the last AI run</b>
            Re-run AI to include PDFs added or re-read since {fmtDateTime(ai.ai_extracted_at!)}. Your confirmed items are kept.
          </div>
        )}

        {tab === 'review' ? (
          <>
            {ai.ai_status === 'done' && ai.ai_fields && (
              <>
                <div className="section-head">
                  <h3 className="ai-sub">Key facts</h3>
                  <button className="btn" onClick={() => onFillDetails(prefillFromAi(ai.ai_fields!.fields))}>Fill tender details</button>
                </div>
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
                                <button className="btn ghost" onClick={() => onOpenSource(fid, f.page, f.quote)} title={f.quote ?? ''}>{where(fid, f.page)}</button>
                              )}
                            </td>
                            <td className="conf">{f.status === 'found' && <ConfidencePill c={f.confidence} unverified={f.verified === false} />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="section-head">
              <h3 className="ai-sub">To review <span className="muted small">({toReview.length})</span></h3>
              {highConfidence.length > 0 && (
                <button className="btn" onClick={() => update(highConfidence.map((r) => r.id), { confirmed: true }, `${highConfidence.length} confirmed.`)}>
                  Confirm all high-confidence ({highConfidence.length})
                </button>
              )}
            </div>
            {toReview.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {reqs.length ? 'Everything is reviewed. Your checklist is ready.' : 'Nothing to review yet.'}
              </p>
            ) : (
              <>
                {priority(toReview[0]) === 0 && (
                  <p className="small muted" style={{ margin: 0 }}>Items that need a closer look come first. Open the source page before you confirm them.</p>
                )}
                <ul className="req-list">
                  {toReview.map((r) => (
                    <li key={r.id} className={priority(r) === 0 ? 'attention' : ''}>
                      <ReqText r={r} />
                      <div className="req-meta">
                        {r.source_page && (
                          <button className="btn ghost" onClick={() => onOpenSource(r.source_file_id, r.source_page, r.quote)} title={r.quote ?? ''}>
                            {where(r.source_file_id, r.source_page)}
                          </button>
                        )}
                        <ConfidencePill c={r.confidence} keyword={r.added_by === 'keyword_check'} unverified={r.verified === false} />
                      </div>
                      <div className="req-actions">
                        <button className="btn primary" disabled={busyIds.has(r.id)} onClick={() => update([r.id], { confirmed: true })}>Confirm</button>
                        <button className="btn" disabled={busyIds.has(r.id)} onClick={() => setEditing(r)}>Edit</button>
                        <button className="btn" disabled={busyIds.has(r.id)} onClick={() => update([r.id], { confirmed: true, status: 'not_applicable' }, 'Marked not required.')}>
                          Not required
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {ai.ai_status === 'done' && ai.ai_model && (
              <p className="small muted" style={{ margin: 0 }}>
                AI run: {ai.ai_model} · {fmtDateTime(ai.ai_extracted_at!)}
              </p>
            )}
          </>
        ) : (
          <Checklist
            tender={tender}
            confirmed={confirmed}
            dismissed={dismissed}
            unreviewed={toReview.length}
            vault={vault}
            busyIds={busyIds}
            where={where}
            onOpenSource={onOpenSource}
            onToggle={(r) => update([r.id], { status: r.status === 'done' ? 'todo' : 'done' })}
            onEdit={setEditing}
            onRestore={(r) => update([r.id], { status: 'todo' }, 'Restored to the checklist.')}
            onOpenVault={onOpenVault}
            onReview={() => setTab('review')}
          />
        )}
      </div>

      {editing && (
        <EditModal
          tenderId={tender.id}
          item={editing === 'new' ? null : editing}
          nextOrder={reqs.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            toast(msg);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function ReqText({ r }: { r: Requirement }) {
  return (
    <div className="what">
      <span className="req-name">
        {r.description}
        {r.mandatory && isDoc(r) && <span className="req-tag">Mandatory</span>}
        {r.doc_type && isDoc(r) && <span className="req-tag vault">Vault: {docTypeInfo(r.doc_type).name}</span>}
        {!isDoc(r) && <span className="req-tag plain">{KIND_LABEL[r.kind]}</span>}
        {r.added_by === 'user' && <span className="req-tag plain">Added by you</span>}
      </span>
      {r.conditions && <span className="small muted">{r.conditions}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- checklist

function Checklist({
  tender, confirmed, dismissed, unreviewed, vault, busyIds, where, onOpenSource, onToggle, onEdit, onRestore, onOpenVault, onReview,
}: {
  tender: Tender;
  confirmed: Requirement[];
  dismissed: Requirement[];
  unreviewed: number;
  vault: VaultDoc[];
  busyIds: Set<string>;
  where: (fileId: string | null, page: number | null) => string;
  onOpenSource: SourceFn;
  onToggle: (r: Requirement) => void;
  onEdit: (r: Requirement) => void;
  onRestore: (r: Requirement) => void;
  onOpenVault: () => void;
  onReview: () => void;
}) {
  const docs = confirmed.filter(isDoc);
  const disq = confirmed.filter((r) => r.kind === 'disqualifier');
  const special = confirmed.filter((r) => r.kind === 'special');
  const matches = new Map(docs.filter((r) => r.doc_type).map((r) => [r.id, matchVault(r.doc_type!, vault, tender.closing_at)]));
  const vaultProblems = [...matches.values()].filter((m) => m.tone !== 'ok').length;
  const ticked = docs.filter((r) => r.status === 'done').length;

  if (!confirmed.length) {
    return (
      <div className="empty-state" style={{ padding: '8px 0' }}>
        <b>No checklist yet</b>
        <p className="muted">Confirm items on the Review tab and they appear here, ready to tick off as you prepare the bid.</p>
        {unreviewed > 0 && <button className="btn primary" onClick={onReview}>Review {unreviewed} item{unreviewed === 1 ? '' : 's'}</button>}
      </div>
    );
  }

  return (
    <>
      <div className="check-summary">
        <div><b className="mono">{ticked}/{docs.length}</b><span>documents prepared</span></div>
        <div className={vaultProblems ? 'crit-text' : ''}><b className="mono">{vaultProblems}</b><span>vault problem{vaultProblems === 1 ? '' : 's'}</span></div>
        {unreviewed > 0 && (
          <button className="btn ghost" onClick={onReview}>{unreviewed} still to review</button>
        )}
      </div>
      {!tender.closing_at && docs.some((r) => r.doc_type) && (
        <p className="small muted" style={{ margin: 0 }}>Set the closing date in the tender details to check vault documents are still valid on that day.</p>
      )}

      <h3 className="ai-sub">Documents to submit</h3>
      <ul className="req-list check-list">
        {docs.map((r) => {
          const m = matches.get(r.id);
          return (
            <li key={r.id} className={r.status === 'done' ? 'ticked' : ''}>
              <label className="check">
                <input type="checkbox" checked={r.status === 'done'} disabled={busyIds.has(r.id)} onChange={() => onToggle(r)} />
                <ReqText r={r} />
              </label>
              <div className="req-meta">
                {m && (
                  <span className={`pill ${m.tone}`} title={m.doc ? `${m.doc.file_name}${m.doc.expires_on ? `, expires ${fmtDate(m.doc.expires_on)}` : ''}` : ''}>
                    {m.label}{m.doc?.expires_on && m.state !== 'ready' && m.state !== 'on_file' ? ` (${fmtDate(m.doc.expires_on)})` : ''}
                  </span>
                )}
                {m && m.tone !== 'ok' && <button className="btn ghost" onClick={onOpenVault}>{m.state === 'missing' ? 'Upload' : 'Replace'}</button>}
                {r.source_page && (
                  <button className="btn ghost" onClick={() => onOpenSource(r.source_file_id, r.source_page, r.quote)} title={r.quote ?? ''}>
                    {where(r.source_file_id, r.source_page)}
                  </button>
                )}
                <button className="btn ghost" onClick={() => onEdit(r)} aria-label={`Edit ${r.description}`}>Edit</button>
              </div>
            </li>
          );
        })}
      </ul>

      {disq.length > 0 && (
        <>
          <h3 className="ai-sub">Avoid disqualification</h3>
          <ul className="req-list">
            {disq.map((r) => (
              <li key={r.id}>
                <ReqText r={r} />
                <div className="req-meta">
                  {r.source_page && (
                    <button className="btn ghost" onClick={() => onOpenSource(r.source_file_id, r.source_page, r.quote)} title={r.quote ?? ''}>
                      {where(r.source_file_id, r.source_page)}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {special.length > 0 && (
        <>
          <h3 className="ai-sub">Other requirements</h3>
          <ul className="req-list">
            {special.map((r) => (
              <li key={r.id}>
                <ReqText r={r} />
                <div className="req-meta">
                  {r.source_page && (
                    <button className="btn ghost" onClick={() => onOpenSource(r.source_file_id, r.source_page, r.quote)}>{where(r.source_file_id, r.source_page)}</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {dismissed.length > 0 && (
        <details className="history">
          <summary>{dismissed.length} marked not required</summary>
          <ul>
            {dismissed.map((r) => (
              <li key={r.id}>
                {r.description} <button className="btn ghost" onClick={() => onRestore(r)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// ---------------------------------------------------------------- edit / add

function EditModal({
  tenderId, item, nextOrder, onClose, onSaved,
}: {
  tenderId: string;
  item: Requirement | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [description, setDescription] = useState(item?.description ?? '');
  const [kind, setKind] = useState<RequirementKind>(item && EDIT_KINDS.includes(item.kind) ? item.kind : 'document');
  const [mandatory, setMandatory] = useState(item?.mandatory ?? true);
  const [docType, setDocType] = useState<DocType | ''>(item?.doc_type ?? '');
  const [conditions, setConditions] = useState(item?.conditions ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doc = kind !== 'disqualifier' && kind !== 'special';

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!description.trim()) return setError('Describe the item.');
    setBusy(true);
    const fields = {
      description: description.trim(),
      kind,
      mandatory: doc ? mandatory : true,
      doc_type: doc && docType ? docType : null,
      conditions: conditions.trim() || null,
      confirmed: true,
    };
    const { error: e } = item
      ? await supabase.from('requirements').update(fields).eq('id', item.id)
      : await supabase.from('requirements').insert({ ...fields, tender_id: tenderId, added_by: 'user', status: 'todo', sort_order: nextOrder });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    onSaved(item ? 'Saved and confirmed.' : 'Item added.');
  };

  return (
    <Modal
      title={item ? 'Edit item' : 'Add item'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="submit" form="req-form" disabled={busy}>{busy ? 'Saving…' : item ? 'Save and confirm' : 'Add'}</button>
        </>
      }
    >
      <form id="req-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {item?.quote && (
          <div className="quote-box">
            <span className="eyebrow">The tender says</span>
            <q>{item.quote}</q>
          </div>
        )}
        <label className="field">
          <span>Description</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} required autoFocus />
        </label>
        <label className="field">
          <span>Type</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as RequirementKind)}>
            {EDIT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {doc && (
          <>
            <label className="field">
              <span>Matching vault document</span>
              <select className="select" value={docType} onChange={(e) => setDocType(e.target.value as DocType | '')}>
                <option value="">None: prepared for this tender</option>
                {DOC_TYPES.filter((t) => t.type !== 'other').map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
              </select>
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              Mandatory (missing it can disqualify the bid)
            </label>
          </>
        )}
        <label className="field">
          <span>Conditions (optional)</span>
          <input className="input" value={conditions} onChange={(e) => setConditions(e.target.value)} maxLength={500}
            placeholder="e.g. signed and stamped by a Commissioner of Oaths" />
        </label>
        {error && <div className="callout crit">{error}</div>}
      </form>
    </Modal>
  );
}
