import { useEffect, useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';
import { TENDER_STATUS_LABEL, type Company, type Tender, type TenderStatus } from '../lib/types';
import { closingIn, fmtDateTime, fmtSize, fromLocalInput } from '../lib/dates';
import { checkPdf, uploadTenderFiles } from '../lib/tenderFiles';
import { Modal, useToast } from '../components/ui';

interface Row extends Tender {
  tender_files: { status: string }[];
}

export default function Tenders({ company, onOpen }: { company: Company; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase
      .from('tenders')
      .select('id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, status, created_at, tender_files(status)')
      .order('closing_at', { ascending: true, nullsFirst: false })
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setRows(data as Row[])));
  }, []);

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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tender</th>
                  <th>Issued by</th>
                  <th>Closing</th>
                  <th>Files</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const done = t.tender_files.filter((f) => f.status === 'done').length;
                  const failed = t.tender_files.filter((f) => f.status === 'failed').length;
                  const c = t.closing_at ? closingIn(t.closing_at) : null;
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
                            {['reviewing', 'preparing'].includes(t.status) && <span className={`pill ${c!.tone}`}>{c!.label}</span>}
                          </>
                        ) : (
                          <span className="muted">Not set</span>
                        )}
                      </td>
                      <td className="mono">
                        {done}/{t.tender_files.length} read
                        {failed > 0 && <div><span className="pill crit">{failed} failed</span></div>}
                      </td>
                      <td>
                        <span className={`pill ${t.status === 'won' ? 'ok' : t.status === 'lost' || t.status === 'not_bidding' ? 'plain' : 'accent'}`}>
                          {TENDER_STATUS_LABEL[t.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && <NewTenderModal companyId={company.id} onClose={() => setCreating(false)} onCreated={onOpen} />}
    </div>
  );
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
        <p className="hint" style={{ margin: 0 }}>The fields below are optional. From week 3 they'll be filled in from the PDF for you to confirm.</p>
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
