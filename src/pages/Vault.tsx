import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { friendlyError, supabase } from '../lib/supabase';
import { DOC_TYPES, docTypeInfo, type Company, type CompanyDocument, type DocType } from '../lib/types';
import { expiryState, fmtDate, fmtSize } from '../lib/dates';
import { ExpiryPill, MissingPill, Modal, useToast } from '../components/ui';

const BUCKET = 'vault';
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];

type VaultFilter = 'all' | 'ready' | 'expiring' | 'problem';

interface Slot {
  type: DocType;
  current: CompanyDocument | null; // newest upload of this type ('other' has one slot per document)
  older: CompanyDocument[];
}

export default function Vault({ company }: { company: Company }) {
  const toast = useToast();
  const [docs, setDocs] = useState<CompanyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<DocType | 'new' | null>(null);
  const [editing, setEditing] = useState<CompanyDocument | null>(null);
  const [removing, setRemoving] = useState<CompanyDocument | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('company_documents')
      .select('id, doc_type, label, file_path, file_name, file_size, issued_on, expires_on, notes, created_at')
      .order('created_at', { ascending: false });
    if (e) return setError(friendlyError(e));
    setError(null);
    setDocs(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const slots = useMemo<Slot[]>(() => {
    if (!docs) return [];
    const out: Slot[] = [];
    for (const t of DOC_TYPES) {
      if (t.type === 'other') continue;
      const ofType = docs.filter((d) => d.doc_type === t.type);
      out.push({ type: t.type, current: ofType[0] ?? null, older: ofType.slice(1) });
    }
    for (const d of docs.filter((x) => x.doc_type === 'other')) out.push({ type: 'other', current: d, older: [] });
    return out;
  }, [docs]);

  const counts = useMemo(() => {
    const c = { ready: 0, expiring: 0, expired: 0, missing: 0 };
    for (const s of slots) {
      if (!s.current) {
        if (docTypeInfo(s.type).core) c.missing++;
        continue;
      }
      const st = expiryState(s.current.expires_on);
      if (st === 'expired') c.expired++;
      else if (st === 'expiring') c.expiring++;
      else c.ready++;
    }
    return c;
  }, [slots]);

  const [filter, setFilter] = useState<VaultFilter>('all');
  const slotState = (s: Slot): VaultFilter => {
    if (!s.current) return docTypeInfo(s.type).core ? 'problem' : 'all';
    const st = expiryState(s.current.expires_on);
    return st === 'expired' ? 'problem' : st === 'expiring' ? 'expiring' : 'ready';
  };
  const shownSlots = filter === 'all' ? slots : slots.filter((s) => slotState(s) === filter);

  const open = async (d: CompanyDocument) => {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(d.file_path, 60);
    if (e || !data) return toast(friendlyError(e));
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Document vault</h1>
          <p>
            The standard documents {company.name} attaches to bids. Keep expiry dates current: each tender's checklist will be matched against
            this vault.
          </p>
        </div>
        <button className="btn primary" onClick={() => setUploadFor('new')}>
          Upload document
        </button>
      </div>

      {error && <div className="callout crit">{error}</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>Documents</h2>
          <span className="small muted">PDF, JPG or PNG · up to 10 MB · private to your company</span>
        </div>
        {docs && (
          <div className="dtabs" role="tablist" aria-label="Filter by status">
            {([
              ['all', 'All', 'slate', slots.length],
              ['ready', 'Ready', 'ready', counts.ready],
              ['expiring', 'Expiring soon', 'review', counts.expiring],
              ['problem', 'Expired or missing', 'crit', counts.expired + counts.missing],
            ] as [VaultFilter, string, string, number][]).map(([key, label, tone, n]) => (
              <button key={key} role="tab" data-tone={tone} aria-selected={filter === key} onClick={() => setFilter(key)}>
                {label} <span className="n">{n}</span>
              </button>
            ))}
          </div>
        )}
        {!docs ? (
          <p className="panel-body muted">Loading…</p>
        ) : shownSlots.length === 0 ? (
          <p className="panel-body muted">Nothing here.</p>
        ) : (
          <ul className="doc-list">
            {shownSlots.map((s) => {
              const info = docTypeInfo(s.type);
              const d = s.current;
              return (
                <li key={d?.id ?? s.type}>
                  <div className="what">
                    <b>{s.type === 'other' ? d?.label : info.name}</b>
                    {d ? (
                      <div className="meta">
                        <span className="file" title={d.file_name}>{d.file_name}</span>
                        {d.file_size != null && <span>{fmtSize(d.file_size)}</span>}
                        {d.issued_on && <span>Issued {fmtDate(d.issued_on)}</span>}
                        {d.expires_on ? <span>Expires {fmtDate(d.expires_on)}</span> : info.expires && <span>No expiry date entered</span>}
                      </div>
                    ) : (
                      <div className="meta">{info.core ? 'Asked for in most public-sector bids.' : 'Needed for some tenders.'}</div>
                    )}
                  </div>
                  <div className="actions">
                    {d ? <ExpiryPill expires_on={d.expires_on} /> : <MissingPill core={info.core} />}
                    {d && (
                      <>
                        <button className="btn" onClick={() => open(d)}>View</button>
                        <button className="btn" onClick={() => setEditing(d)}>Edit dates</button>
                      </>
                    )}
                    {s.type !== 'other' && (
                      <button className={d ? 'btn' : 'btn primary'} onClick={() => setUploadFor(s.type)}>
                        {d ? 'Replace' : 'Upload'}
                      </button>
                    )}
                    {d && (
                      <button className="btn danger" onClick={() => setRemoving(d)}>
                        Delete
                      </button>
                    )}
                  </div>
                  {s.older.length > 0 && (
                    <details className="history">
                      <summary><ChevronRight className="ico" aria-hidden="true" />{s.older.length} earlier version{s.older.length > 1 ? 's' : ''}</summary>
                      <ul>
                        {s.older.map((o) => (
                          <li key={o.id}>
                            <button className="btn ghost" onClick={() => open(o)}>{o.file_name}</button> uploaded {fmtDate(o.created_at)}
                            {o.expires_on && <> · expires {fmtDate(o.expires_on)}</>}
                            {' · '}
                            <button className="btn ghost danger" onClick={() => setRemoving(o)}>Delete</button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {uploadFor && (
        <UploadModal
          companyId={company.id}
          initialType={uploadFor === 'new' ? null : uploadFor}
          onClose={() => setUploadFor(null)}
          onDone={async (msg) => {
            setUploadFor(null);
            toast(msg);
            await load();
          }}
        />
      )}
      {editing && (
        <EditDatesModal
          doc={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            toast('Dates saved.');
            await load();
          }}
        />
      )}
      {removing && (
        <DeleteModal
          doc={removing}
          onClose={() => setRemoving(null)}
          onDone={async () => {
            setRemoving(null);
            toast('Document deleted.');
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- upload

function UploadModal({
  companyId,
  initialType,
  onClose,
  onDone,
}: {
  companyId: string;
  initialType: DocType | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [type, setType] = useState<DocType | ''>(initialType ?? '');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = type ? docTypeInfo(type) : null;

  const pick = (f: File | null) => {
    setError(null);
    if (f && !ACCEPT.includes(f.type)) return setError('Upload a PDF, JPG or PNG.');
    if (f && f.size > MAX_BYTES) return setError('That file is too big. The limit is 10 MB.');
    setFile(f);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!type || !file) return;
    if (expires && issued && expires < issued) return setError('The expiry date is before the issue date.');
    setBusy(true);
    setError(null);
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${companyId}/${crypto.randomUUID()}-${safeName}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusy(false);
      return setError(friendlyError(up.error));
    }
    const { error: e } = await supabase.from('company_documents').insert({
      doc_type: type,
      label: type === 'other' ? label.trim() : null,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      issued_on: issued || null,
      expires_on: expires || null,
      notes: notes.trim() || null,
    });
    if (e) {
      // Don't leave an orphaned file behind if the row failed.
      await supabase.storage.from(BUCKET).remove([path]);
      setBusy(false);
      return setError(friendlyError(e));
    }
    onDone(`${type === 'other' ? label.trim() : docTypeInfo(type).name} uploaded.`);
  };

  return (
    <Modal
      title={initialType ? `Upload ${docTypeInfo(initialType).name}` : 'Upload document'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="submit" form="upload-form" disabled={busy || !type || !file}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      <form id="upload-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!initialType && (
          <label className="field">
            <span>Document type</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as DocType)} required>
              <option value="" disabled>Choose…</option>
              {DOC_TYPES.map((t) => (
                <option key={t.type} value={t.type}>{t.name}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'other' && (
          <label className="field">
            <span>Name</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} />
          </label>
        )}
        {info && <p className="hint" style={{ margin: 0 }}>{info.hint}</p>}
        <label className="file-pick">
          <span className="small">{file ? `${file.name} · ${fmtSize(file.size)}` : 'Choose a PDF, JPG or PNG (max 10 MB)'}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => pick(e.target.files?.[0] ?? null)} required />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Issue date</span>
            <input className="input" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
          </label>
          <label className="field">
            <span>Expiry date{info?.expires ? '' : ' (if any)'}</span>
            <input className="input" type="date" value={expires} min={issued || undefined} onChange={(e) => setExpires(e.target.value)} required={!!info?.expires && type !== 'other'} />
          </label>
        </div>
        <label className="field">
          <span>Notes (optional)</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </label>
        {initialType && <p className="hint" style={{ margin: 0 }}>The previous version is kept under "earlier versions".</p>}
        {error && <div className="callout crit">{error}</div>}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- edit dates

function EditDatesModal({ doc, onClose, onDone }: { doc: CompanyDocument; onClose: () => void; onDone: () => void }) {
  const [issued, setIssued] = useState(doc.issued_on ?? '');
  const [expires, setExpires] = useState(doc.expires_on ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (expires && issued && expires < issued) return setError('The expiry date is before the issue date.');
    setBusy(true);
    const { error: e } = await supabase
      .from('company_documents')
      .update({ issued_on: issued || null, expires_on: expires || null })
      .eq('id', doc.id);
    if (e) {
      setBusy(false);
      return setError(friendlyError(e));
    }
    onDone();
  };

  return (
    <Modal
      title={`Dates · ${doc.label ?? docTypeInfo(doc.doc_type).name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="submit" form="dates-form" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="dates-form" onSubmit={save} className="form-grid">
        <label className="field">
          <span>Issue date</span>
          <input className="input" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </label>
        <label className="field">
          <span>Expiry date</span>
          <input className="input" type="date" value={expires} min={issued || undefined} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </form>
      {error && <div className="callout crit" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- delete

function DeleteModal({ doc, onClose, onDone }: { doc: CompanyDocument; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const { error: e } = await supabase.from('company_documents').delete().eq('id', doc.id);
    if (e) {
      setBusy(false);
      return setError(friendlyError(e));
    }
    // Row first, then file: a failed file delete leaves an unreachable object, never a broken row.
    await supabase.storage.from(BUCKET).remove([doc.file_path]);
    onDone();
  };

  return (
    <Modal
      title="Delete document?"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} onClick={remove} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        <b>{doc.file_name}</b> will be removed from the vault and storage. Its expiry reminders are cancelled. This can't be undone.
      </p>
      {error && <div className="callout crit" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
