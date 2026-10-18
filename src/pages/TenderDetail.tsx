import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';
import { TENDER_STATUS_LABEL, type Company, type PageText, type Tender, type TenderFile, type TenderStatus } from '../lib/types';
import { closingIn, fmtDateTime, fmtSize, fromLocalInput, toLocalInput } from '../lib/dates';
import { TENDER_BUCKET, checkPdf, uploadTenderFiles } from '../lib/tenderFiles';
import { Modal, useToast } from '../components/ui';

const FILE_COLS = 'id, tender_id, file_path, file_name, file_size, status, error, page_count, ocr_used, ocr_pages, extracted_at, created_at';
const POLL_MS = 4000;
const WORKER_HINT_AFTER_MS = 2 * 60 * 1000;

export default function TenderDetail({ id, company, onBack }: { id: string; company: Company; onBack: () => void }) {
  const toast = useToast();
  const [tender, setTender] = useState<Tender | null>(null);
  const [files, setFiles] = useState<TenderFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<TenderFile | null>(null);
  const [removingFile, setRemovingFile] = useState<TenderFile | null>(null);
  const [removingTender, setRemovingTender] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadFiles = useCallback(async () => {
    const { data, error: e } = await supabase.from('tender_files').select(FILE_COLS).eq('tender_id', id).order('created_at');
    if (e) return setError(friendlyError(e));
    setFiles(data as TenderFile[]);
  }, [id]);

  useEffect(() => {
    supabase
      .from('tenders')
      .select('id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, status, created_at')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : data ? setTender(data as Tender) : setError('This tender no longer exists.')));
    loadFiles();
  }, [id, loadFiles]);

  // Poll while the worker still has files to read.
  const pending = files?.some((f) => f.status === 'queued' || f.status === 'extracting') ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(loadFiles, POLL_MS);
    return () => window.clearInterval(t);
  }, [pending, loadFiles]);

  const stuck = files?.some((f) => f.status === 'queued' && Date.now() - new Date(f.created_at).getTime() > WORKER_HINT_AFTER_MS);
  const totals = useMemo(() => {
    const done = files?.filter((f) => f.status === 'done') ?? [];
    return { done: done.length, pages: done.reduce((a, f) => a + (f.page_count ?? 0), 0), ocr: done.reduce((a, f) => a + f.ocr_pages.length, 0) };
  }, [files]);

  const addFiles = async (list: FileList | null) => {
    if (!list || !tender) return;
    const picked = Array.from(list);
    const bad = picked.map(checkPdf).filter(Boolean) as string[];
    if (bad.length) toast(bad.join(' '));
    const ok = picked.filter((f) => !checkPdf(f));
    if (!ok.length) return;
    setUploading(true);
    const { failed } = await uploadTenderFiles(company.id, tender.id, ok);
    setUploading(false);
    toast(failed.length ? `${failed.length} file(s) failed: ${failed.map((f) => `${f.name} (${f.error})`).join('; ')}` : `${ok.length} file(s) added.`);
    loadFiles();
  };

  const retry = async (f: TenderFile) => {
    const { error: e } = await supabase.from('tender_files').update({ status: 'queued' }).eq('id', f.id);
    if (e) return toast(friendlyError(e));
    loadFiles();
  };

  const openPdf = async (f: TenderFile) => {
    const { data, error: e } = await supabase.storage.from(TENDER_BUCKET).createSignedUrl(f.file_path, 60);
    if (e || !data) return toast(friendlyError(e));
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (error)
    return (
      <div className="page">
        <button className="btn ghost back" onClick={onBack}>← Tenders</button>
        <div className="callout crit">{error}</div>
      </div>
    );
  if (!tender || !files) return <div className="page"><p className="muted">Loading…</p></div>;

  const c = tender.closing_at ? closingIn(tender.closing_at) : null;
  return (
    <div className="page">
      <button className="btn ghost back" onClick={onBack}>← Tenders</button>
      <div className="page-head">
        <div>
          <h1>{tender.reference_no || 'Untitled tender'}</h1>
          <p>
            {[tender.entity, tender.description].filter(Boolean).join(' · ') || 'Add the details below.'}
            {c && ['reviewing', 'preparing'].includes(tender.status) && <> <span className={`pill ${c.tone}`}>{c.label}</span></>}
          </p>
        </div>
        <button className="btn danger" onClick={() => setRemovingTender(true)}>Delete tender</button>
      </div>

      <div className="grid g-3-1">
        <section className="panel">
          <div className="panel-head">
            <h2>Documents</h2>
            <label className={`btn ${uploading ? 'disabled' : ''}`}>
              {uploading ? 'Uploading…' : 'Add PDFs'}
              <input type="file" accept=".pdf,application/pdf" multiple hidden disabled={uploading} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          {stuck && (
            <div className="callout warn" style={{ margin: 16, marginBottom: 0 }}>
              <b>Files are waiting for the extraction worker</b>
              Start it on your computer with <span className="mono">python worker.py</span> in the <span className="mono">worker</span> folder.
            </div>
          )}
          {files.length === 0 ? (
            <p className="panel-body muted">No PDFs yet. Add the tender document and its annexures.</p>
          ) : (
            <ul className="doc-list">
              {files.map((f) => (
                <li key={f.id}>
                  <div className="what">
                    <b className="file" title={f.file_name}>{f.file_name}</b>
                    <div className="meta">
                      {f.file_size != null && <span>{fmtSize(f.file_size)}</span>}
                      {f.page_count != null && <span>{f.page_count} pages</span>}
                      {f.ocr_pages.length > 0 && <span>OCR on {f.ocr_pages.length === f.page_count ? 'all pages' : `p. ${f.ocr_pages.join(', ')}`}</span>}
                      <span>Uploaded {fmtDateTime(f.created_at)}</span>
                    </div>
                    {f.error && <div className={`small ${f.status === 'failed' ? 'crit-text' : 'warn-text'}`}>{f.error}</div>}
                  </div>
                  <div className="actions">
                    <ExtractionPill status={f.status} />
                    {f.status === 'done' && <button className="btn" onClick={() => setViewing(f)}>View text</button>}
                    {f.status === 'failed' && <button className="btn" onClick={() => retry(f)}>Retry</button>}
                    <button className="btn" onClick={() => openPdf(f)}>Open PDF</button>
                    <button className="btn danger" onClick={() => setRemovingFile(f)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totals.done > 0 && (
            <div className="panel-foot small muted">
              {totals.pages} pages read from {totals.done} file{totals.done > 1 ? 's' : ''}
              {totals.ocr > 0 && `, ${totals.ocr} by OCR`}. Requirement extraction arrives in week 3.
            </div>
          )}
        </section>

        <DetailsForm tender={tender} onSaved={(t) => { setTender(t); toast('Details saved.'); }} />
      </div>

      {viewing && <TextViewer file={viewing} onClose={() => setViewing(null)} />}
      {removingFile && (
        <ConfirmModal
          title="Delete file?"
          body={<><b>{removingFile.file_name}</b> and its extracted text will be removed. This can't be undone.</>}
          onClose={() => setRemovingFile(null)}
          onConfirm={async () => {
            const { error: e } = await supabase.from('tender_files').delete().eq('id', removingFile.id);
            if (e) return friendlyError(e);
            await supabase.storage.from(TENDER_BUCKET).remove([removingFile.file_path]);
            setRemovingFile(null);
            toast('File deleted.');
            loadFiles();
            return null;
          }}
        />
      )}
      {removingTender && (
        <ConfirmModal
          title="Delete tender?"
          body={<>This removes <b>{tender.reference_no || 'this tender'}</b>, its {files.length} file{files.length === 1 ? '' : 's'} and everything extracted from them. This can't be undone.</>}
          onClose={() => setRemovingTender(false)}
          onConfirm={async () => {
            const { error: e } = await supabase.from('tenders').delete().eq('id', tender.id);
            if (e) return friendlyError(e);
            if (files.length) await supabase.storage.from(TENDER_BUCKET).remove(files.map((f) => f.file_path));
            toast('Tender deleted.');
            onBack();
            return null;
          }}
        />
      )}
    </div>
  );
}

function ExtractionPill({ status }: { status: TenderFile['status'] }) {
  if (status === 'done') return <span className="pill ok">Read</span>;
  if (status === 'failed') return <span className="pill crit">Failed</span>;
  if (status === 'extracting') return <span className="pill accent">Reading…</span>;
  return <span className="pill warn">Waiting</span>;
}

// ---------------------------------------------------------------- details

function DetailsForm({ tender, onSaved }: { tender: Tender; onSaved: (t: Tender) => void }) {
  const [ref, setRef] = useState(tender.reference_no ?? '');
  const [entity, setEntity] = useState(tender.entity ?? '');
  const [desc, setDesc] = useState(tender.description ?? '');
  const [closing, setClosing] = useState(toLocalInput(tender.closing_at));
  const [briefing, setBriefing] = useState(toLocalInput(tender.briefing_at));
  const [compulsory, setCompulsory] = useState(tender.briefing_compulsory ? 'yes' : tender.briefing_compulsory === false ? 'no' : '');
  const [status, setStatus] = useState<TenderStatus>(tender.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('tenders')
      .update({
        reference_no: ref.trim() || null,
        entity: entity.trim() || null,
        description: desc.trim() || null,
        closing_at: fromLocalInput(closing),
        briefing_at: fromLocalInput(briefing),
        briefing_compulsory: compulsory === '' ? null : compulsory === 'yes',
        status,
      })
      .eq('id', tender.id)
      .select('id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, status, created_at')
      .single();
    setBusy(false);
    if (e || !data) return setError(friendlyError(e));
    onSaved(data as Tender);
  };

  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-head"><h2>Details</h2></div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          <span>Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TenderStatus)}>
            {(Object.keys(TENDER_STATUS_LABEL) as TenderStatus[]).map((s) => <option key={s} value={s}>{TENDER_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field"><span>Reference number</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} /></label>
        <label className="field"><span>Issued by</span><input className="input" value={entity} onChange={(e) => setEntity(e.target.value)} maxLength={200} /></label>
        <label className="field"><span>Short description</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></label>
        <label className="field"><span>Closing date and time</span><input className="input" type="datetime-local" value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
        <label className="field"><span>Briefing session</span><input className="input" type="datetime-local" value={briefing} onChange={(e) => setBriefing(e.target.value)} /></label>
        <label className="field">
          <span>Briefing compulsory?</span>
          <select className="select" value={compulsory} onChange={(e) => setCompulsory(e.target.value)}>
            <option value="">Unknown / no briefing</option>
            <option value="yes">Yes, compulsory</option>
            <option value="no">No, optional</option>
          </select>
        </label>
        {error && <div className="callout crit">{error}</div>}
        <div><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button></div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- text viewer

function TextViewer({ file, onClose }: { file: TenderFile; onClose: () => void }) {
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase
      .from('tender_files')
      .select('extracted_text')
      .eq('id', file.id)
      .single()
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : setPages((data?.extracted_text as PageText[]) ?? [])));
  }, [file.id]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || !pages) return [];
    return pages.filter((p) => p.text.toLowerCase().includes(term)).map((p) => p.page);
  }, [q, pages]);

  const current = pages?.find((p) => p.page === page);
  const max = pages?.length ?? 1;

  return (
    <Modal title={file.file_name} onClose={onClose}>
      {error && <div className="callout crit">{error}</div>}
      {!pages ? (
        <p className="muted">Loading text…</p>
      ) : (
        <div className="viewer">
          <div className="toolbar">
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>←</button>
            <span className="mono">Page {page} / {max}</span>
            <button className="btn" onClick={() => setPage((p) => Math.min(max, p + 1))} disabled={page >= max}>→</button>
            {current?.ocr && <span className="pill warn">OCR: check against the PDF</span>}
            <input className="input search" placeholder="Find, e.g. SBD 4" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in text" />
          </div>
          {q.trim() && (
            <div className="small muted">
              {hits.length ? <>Found on page{hits.length > 1 ? 's' : ''}: {hits.map((h) => (
                <button key={h} className={`btn ghost ${h === page ? 'on' : ''}`} onClick={() => setPage(h)}>{h}</button>
              ))}</> : 'Not found'}
            </div>
          )}
          <pre className="page-text">{current?.text ? <Highlight text={current.text} term={q.trim()} /> : <span className="muted">No text on this page.</span>}</pre>
        </div>
      )}
    </Modal>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

// ---------------------------------------------------------------- confirm

function ConfirmModal({ title, body, onClose, onConfirm }: { title: string; body: React.ReactNode; onClose: () => void; onConfirm: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn primary"
            style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const err = await onConfirm();
              if (err) { setError(err); setBusy(false); }
            }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
      {error && <div className="callout crit" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
