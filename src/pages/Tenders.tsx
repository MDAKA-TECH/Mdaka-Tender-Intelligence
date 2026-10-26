import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';
import { ACTIVE_STATUSES, TENDER_STATUS_LABEL, docTypeInfo, type Company, type Tender, type TenderStatus } from '../lib/types';
import { EXPIRING_DAYS, closingIn, daysUntil, fmtDateTime, fmtSize, fromLocalInput } from '../lib/dates';
import type { VaultDoc } from '../lib/vault';
import { checkPdf, uploadTenderFiles } from '../lib/tenderFiles';
import { Modal, useToast } from '../components/ui';

interface Row extends Tender {
  tender_files: { status: string }[];
  requirements: { confirmed: boolean; status: string; kind: string; mandatory: boolean }[];
}

type Tab = 'active' | 'submitted' | 'won' | 'lost' | 'not_bidding' | 'all';
const TABS: { tab: Tab; label: string; match: (s: TenderStatus) => boolean }[] = [
  { tab: 'active', label: 'Active', match: (s) => ACTIVE_STATUSES.includes(s) },
  { tab: 'submitted', label: 'Submitted', match: (s) => s === 'submitted' },
  { tab: 'won', label: 'Won', match: (s) => s === 'won' },
  { tab: 'lost', label: 'Lost', match: (s) => s === 'lost' },
  { tab: 'not_bidding', label: 'Not bidding', match: (s) => s === 'not_bidding' },
  { tab: 'all', label: 'All', match: () => true },
];
const TAB_KEY = 'ti.tenders.tab';

export default function Tenders({ company, onOpen, onOpenVault }: { company: Company; onOpen: (id: string) => void; onOpenVault: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [vault, setVault] = useState<VaultDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'active';
    } catch {
      return 'active';
    }
  });
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase
      .from('tenders')
      .select('id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, status, created_at, tender_files(status), requirements(confirmed, status, kind, mandatory)')
      .order('closing_at', { ascending: true, nullsFirst: false })
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setRows(data as Row[])));
    supabase
      .from('company_documents')
      .select('id, doc_type, label, file_name, expires_on, created_at')
      .then(({ data }) => setVault((data as VaultDoc[]) ?? []));
  }, []);

  const pickTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode: fine */
    }
  };

  const shown = useMemo(() => {
    if (!rows) return [];
    const match = TABS.find((t) => t.tab === tab)!.match;
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) => match(r.status) && (!term || [r.reference_no, r.entity, r.description].some((v) => v?.toLowerCase().includes(term))),
    );
  }, [rows, tab, q]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tenders</h1>
          <p>Upload a tender pack to start. Each PDF is read page by page so its requirements can be pulled out.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>New tender</button>
      </div>

      {error && <div className="callout crit">{error}</div>}

      {rows && rows.length > 0 && <ComingUp rows={rows} vault={vault} onOpen={onOpen} onOpenVault={onOpenVault} />}

      <section className="panel">
        {!rows ? (
          <p className="panel-body muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="panel-body empty-state">
            <b>No tenders yet</b>
            <p className="muted">Add the RFQ or tender document you're working on, with its annexures and SBD forms.</p>
            <button className="btn primary" onClick={() => setCreating(true)}>New tender</button>
          </div>
        ) : (
          <>
            <div className="list-tools">
              <div className="tabs flat" role="tablist" aria-label="Filter by status">
                {TABS.map((t) => {
                  const n = rows.filter((r) => t.match(r.status)).length;
                  return (
                    <button key={t.tab} role="tab" aria-selected={tab === t.tab} onClick={() => pickTab(t.tab)}>
                      {t.label} <span className="n">{n}</span>
                    </button>
                  );
                })}
              </div>
              <input className="input search" type="search" placeholder="Search reference, issuer or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tenders" />
            </div>
            {shown.length === 0 ? (
              <p className="panel-body muted">{q ? 'No tenders match your search.' : 'No tenders with this status.'}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tender</th>
                      <th>Issued by</th>
                      <th>Closing</th>
                      <th>Files</th>
                      <th>Checklist</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((t) => {
                      const done = t.tender_files.filter((f) => f.status === 'done').length;
                      const failed = t.tender_files.filter((f) => f.status === 'failed').length;
                      const active = ACTIVE_STATUSES.includes(t.status);
                      const c = t.closing_at ? closingIn(t.closing_at) : null;
                      const closed = active && t.closing_at && new Date(t.closing_at).getTime() < Date.now();
                      const briefingSoon = active && t.briefing_at && new Date(t.briefing_at).getTime() > Date.now() && t.briefing_compulsory !== false;
                      return (
                        <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                          <td>
                            <button className="row-link" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>
                              {t.reference_no || 'Untitled tender'}
                            </button>
                            {t.description && <div className="small muted clamp">{t.description}</div>}
                          </td>
                          <td>{t.entity || <span className="muted">—</span>}</td>
                          <td>
                            {t.closing_at ? (
                              <>
                                <div className="mono">{fmtDateTime(t.closing_at)}</div>
                                {active && !closed && <span className={`pill ${c!.tone}`}>{c!.label}</span>}
                              </>
                            ) : (
                              <span className="muted">Not set</span>
                            )}
                            {briefingSoon && (
                              <div className="small muted">
                                {t.briefing_compulsory ? 'Compulsory briefing' : 'Briefing'} {fmtDateTime(t.briefing_at!)}
                              </div>
                            )}
                          </td>
                          <td className="mono">
                            {done}/{t.tender_files.length} read
                            {failed > 0 && <div><span className="pill crit">{failed} failed</span></div>}
                          </td>
                          <td><ChecklistCell reqs={t.requirements} /></td>
                          <td>
                            <span className={`pill ${t.status === 'won' ? 'ok' : t.status === 'lost' || t.status === 'not_bidding' ? 'plain' : 'accent'}`}>
                              {TENDER_STATUS_LABEL[t.status]}
                            </span>
                            {closed && <div><span className="pill warn">Closed: update status</span></div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {creating && <NewTenderModal companyId={company.id} onClose={() => setCreating(false)} onCreated={onOpen} />}
    </div>
  );
}

// ---------------------------------------------------------------- coming up

interface Upcoming {
  key: string;
  at: Date;
  what: string;
  name: string;
  tone: 'crit' | 'warn' | 'plain';
  open: () => void;
}

const COMING_DAYS = 14;

function ComingUp({ rows, vault, onOpen, onOpenVault }: { rows: Row[]; vault: VaultDoc[]; onOpen: (id: string) => void; onOpenVault: () => void }) {
  const items = useMemo(() => {
    const now = Date.now();
    const horizon = now + COMING_DAYS * 86_400_000;
    const out: Upcoming[] = [];
    for (const t of rows) {
      if (!ACTIVE_STATUSES.includes(t.status)) continue;
      const name = t.reference_no || t.description || 'Untitled tender';
      if (t.closing_at) {
        const at = new Date(t.closing_at);
        if (at.getTime() > now && at.getTime() <= horizon)
          out.push({ key: `c${t.id}`, at, what: 'Closes', name, tone: at.getTime() - now < 3 * 86_400_000 ? 'crit' : 'warn', open: () => onOpen(t.id) });
      }
      if (t.briefing_at && t.briefing_compulsory !== false) {
        const at = new Date(t.briefing_at);
        if (at.getTime() > now && at.getTime() <= horizon)
          out.push({ key: `b${t.id}`, at, what: t.briefing_compulsory ? 'Compulsory briefing' : 'Briefing', name, tone: 'warn', open: () => onOpen(t.id) });
      }
    }
    // Newest document of each type is the one that counts.
    const newest = new Map<string, VaultDoc>();
    for (const d of vault) {
      const k = d.doc_type === 'other' ? `other:${d.label ?? ''}` : d.doc_type;
      const cur = newest.get(k);
      if (!cur || d.created_at > cur.created_at) newest.set(k, d);
    }
    for (const d of newest.values()) {
      if (!d.expires_on) continue;
      const n = daysUntil(d.expires_on);
      if (n > EXPIRING_DAYS) continue;
      const [y, m, day] = d.expires_on.split('-').map(Number);
      out.push({
        key: `d${d.id}`,
        at: new Date(y, m - 1, day),
        what: n < 0 ? 'Expired' : 'Expires',
        name: d.doc_type === 'other' ? d.label || d.file_name : docTypeInfo(d.doc_type).name,
        tone: n < 7 ? 'crit' : 'warn',
        open: onOpenVault,
      });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [rows, vault, onOpen, onOpenVault]);

  return (
    <section className="panel coming" aria-labelledby="coming-head">
      <div className="panel-head">
        <h2 id="coming-head">Coming up</h2>
        <span className="small muted">Next {COMING_DAYS} days, and vault documents expiring within {EXPIRING_DAYS} days</span>
      </div>
      {items.length === 0 ? (
        <p className="panel-body muted">Nothing due. Reminder emails go out before closing dates, briefings and document expiry.</p>
      ) : (
        <ul className="coming-list">
          {items.map((i) => (
            <li key={i.key}>
              <button onClick={i.open}>
                <span className="mono when">{fmtShort(i.at, i.what.startsWith('Expir'))}</span>
                <span className={`pill ${i.tone}`}>{i.what}</span>
                <span className="name">{i.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtShort(d: Date, dateOnly: boolean) {
  return d.toLocaleString('en-ZA', dateOnly ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function NewTenderModal({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [ref, setRef] = useState('');
  const [entity, setEntity] = useState('');
  const [desc, setDesc] = useState('');
  const [closing, setClosing] = useState('');
  const [status, setStatus] = useState<TenderStatus>('reviewing');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const bad = picked.map(checkPdf).filter(Boolean);
    setError(bad.length ? bad.join(' ') : null);
    const ok = picked.filter((f) => !checkPdf(f));
    setFiles((cur) => [...cur, ...ok.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (files.length === 0) return setError('Add at least one PDF.');
    setError(null);
    setBusy('Creating tender…');
    const { data, error: e } = await supabase
      .from('tenders')
      .insert({
        reference_no: ref.trim() || null,
        entity: entity.trim() || null,
        description: desc.trim() || null,
        closing_at: fromLocalInput(closing),
        status,
      })
      .select('id')
      .single();
    if (e || !data) {
      setBusy(null);
      return setError(friendlyError(e));
    }
    setBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    const { failed } = await uploadTenderFiles(companyId, data.id, files);
    toast(failed.length ? `Tender created. ${failed.length} file(s) failed to upload.` : 'Tender created. Reading the PDFs now.');
    onCreated(data.id);
  };

  return (
    <Modal
      title="New tender"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="btn primary" type="submit" form="tender-form" disabled={!!busy || files.length === 0}>
            {busy ?? 'Create and upload'}
          </button>
        </>
      }
    >
      <form id="tender-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="file-pick">
          <span className="small">Tender PDFs: the main document, annexures and SBD forms (max 50 MB each)</span>
          <input type="file" accept=".pdf,application/pdf" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {files.length > 0 && (
            <ul className="picked">
              {files.map((f) => (
                <li key={f.name + f.size}>
                  <span>{f.name}</span>
                  <span className="muted small">{fmtSize(f.size)}</span>
                  <button type="button" className="btn ghost" onClick={() => setFiles((cur) => cur.filter((c) => c !== f))} aria-label={`Remove ${f.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="hint" style={{ margin: 0 }}>The fields below are optional. After the PDFs are read, use "Fill tender details" on the tender page to copy them from the documents.</p>
        <div className="form-grid">
          <label className="field">
            <span>Reference number</span>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="RFQ 906/2026" maxLength={80} />
          </label>
          <label className="field">
            <span>Closing date and time</span>
            <input className="input" type="datetime-local" value={closing} onChange={(e) => setClosing(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Issued by</span>
          <input className="input" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Parliament of RSA" maxLength={200} />
        </label>
        <label className="field">
          <span>Short description</span>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Data analyst services" maxLength={300} />
        </label>
        <label className="field">
          <span>Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TenderStatus)}>
            <option value="reviewing">Reviewing</option>
            <option value="preparing">Preparing</option>
          </select>
        </label>
        {error && <div className="callout crit">{error}</div>}
      </form>
    </Modal>
  );
}

function ChecklistCell({ reqs }: { reqs: Row['requirements'] }) {
  const toReview = reqs.filter((r) => !r.confirmed).length;
  const docs = reqs.filter((r) => r.confirmed && r.status !== 'not_applicable' && r.kind !== 'disqualifier' && r.kind !== 'special');
  if (toReview) return <span className="pill warn">{toReview} to review</span>;
  if (!docs.length) return <span className="muted">—</span>;
  const done = docs.filter((r) => r.status === 'done').length;
  return <span className={`mono ${done === docs.length ? 'ok-text' : ''}`}>{done}/{docs.length} prepared</span>;
}
