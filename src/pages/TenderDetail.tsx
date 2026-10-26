import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, FileDown, ListChecks, Send, Trash2, Users } from 'lucide-react';
import { friendlyError, supabase } from '../lib/supabase';
import { ACTIVE_STATUSES, STATUS_TONE, TENDER_STATUS_LABEL, type AppUser, type AuditEntry, type Company, type PageText, type Reminder, type Requirement, type Tender, type TenderAi, type TenderFile, type TenderStatus } from '../lib/types';
import ReviewPanel, { type DetailsPrefill } from '../components/ReviewPanel';
import { fieldValue } from '../lib/fields';
import type { VaultDoc } from '../lib/vault';
import { closingIn, fmtDateTime, fmtSize, fromLocalInput, toLocalInput } from '../lib/dates';
import { TENDER_BUCKET, checkPdf, uploadTenderFiles } from '../lib/tenderFiles';
import { Modal, useToast } from '../components/ui';

const FILE_COLS = 'id, tender_id, file_path, file_name, file_size, status, error, page_count, ocr_used, ocr_pages, extracted_at, created_at';
const POLL_MS = 4000;
const AI_COLS = 'ai_status, ai_error, ai_model, ai_extracted_at, ai_claimed_at, ai_file_ids, ai_fields';
const REQ_COLS = 'id, kind, description, doc_type, mandatory, conditions, source_file_id, source_page, confidence, quote, verified, notes, added_by, confirmed, status, sort_order';
const WORKER_HINT_AFTER_MS = 2 * 60 * 1000;
const TENDER_COLS = 'id, reference_no, entity, description, closing_at, briefing_at, briefing_compulsory, submission_method, status, created_at';

export default function TenderDetail({ id, company, user, onBack, onOpenVault }: { id: string; company: Company; user: AppUser; onBack: () => void; onOpenVault: () => void }) {
  const toast = useToast();
  const [tender, setTender] = useState<Tender | null>(null);
  const [files, setFiles] = useState<TenderFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ file: TenderFile; page?: number; query?: string } | null>(null);
  const [ai, setAi] = useState<TenderAi | null>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [vault, setVault] = useState<VaultDoc[]>([]);
  const [prefill, setPrefill] = useState<{ p: DetailsPrefill; key: number } | null>(null);
  const [removingFile, setRemovingFile] = useState<TenderFile | null>(null);
  const [removingTender, setRemovingTender] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState<{ openMandatory: number; toReview: number } | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rev, setRev] = useState(0); // bump to reload reminders + activity

  const loadFiles = useCallback(async () => {
    const { data, error: e } = await supabase.from('tender_files').select(FILE_COLS).eq('tender_id', id).order('created_at');
    if (e) return setError(friendlyError(e));
    setFiles(data as TenderFile[]);
  }, [id]);

  const loadReqs = useCallback(async () => {
    const { data, error: e } = await supabase.from('requirements').select(REQ_COLS).eq('tender_id', id).order('sort_order');
    if (e) return toast(friendlyError(e));
    setReqs((data as Requirement[]) ?? []);
    setRev((n) => n + 1);
  }, [id, toast]);

  const loadAi = useCallback(async () => {
    const { data, error: e } = await supabase.from('tenders').select(AI_COLS).eq('id', id).maybeSingle();
    if (e || !data) return;
    const next = data as TenderAi;
    setAi((prev) => {
      // A run just finished: fetch its new requirement rows.
      if (prev && next.ai_extracted_at !== prev.ai_extracted_at) loadReqs();
      return next;
    });
  }, [id, loadReqs]);

  useEffect(() => {
    loadReqs();
    supabase
      .from('company_documents')
      .select('id, doc_type, label, file_name, expires_on, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => setVault((data as VaultDoc[]) ?? []));
  }, [loadReqs]);

  useEffect(() => {
    loadAi();
    supabase
      .from('tenders')
      .select(TENDER_COLS)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: e }) => (e ? setError(friendlyError(e)) : data ? setTender(data as Tender) : setError('This tender no longer exists.')));
    loadFiles();
  }, [id, loadFiles, loadAi]);

  // Poll while the worker still has files to read or an AI run to do.
  const filesPending = files?.some((f) => f.status === 'queued' || f.status === 'extracting') ?? false;
  const pending = filesPending || ai?.ai_status === 'queued' || ai?.ai_status === 'running';
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => {
      loadFiles();
      loadAi();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [pending, loadFiles, loadAi]);

  const runAi = async () => {
    const { error: e } = await supabase.from('tenders').update({ ai_status: 'queued' }).eq('id', id);
    if (e) return toast(friendlyError(e));
    toast('Queued for AI extraction.');
    loadAi();
  };

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

  const saveStatus = async (next: TenderStatus) => {
    if (!tender) return;
    setSavingStatus(true);
    const { data, error: e } = await supabase.from('tenders').update({ status: next }).eq('id', tender.id).select(TENDER_COLS).single();
    setSavingStatus(false);
    setConfirmSubmit(null);
    if (e || !data) return toast(friendlyError(e));
    setTender(data as Tender);
    setRev((n) => n + 1);
    toast(ACTIVE_STATUSES.includes(next) ? `Status: ${TENDER_STATUS_LABEL[next]}.` : `Marked as ${TENDER_STATUS_LABEL[next]}. Reminders for this tender are off.`);
  };

  const changeStatus = (next: TenderStatus) => {
    if (next === 'submitted') {
      const docs = reqs.filter((r) => r.confirmed && r.status === 'todo' && r.kind !== 'disqualifier' && r.kind !== 'special');
      const openMandatory = docs.filter((r) => r.mandatory).length;
      const toReview = reqs.filter((r) => !r.confirmed).length;
      if (openMandatory || toReview) return setConfirmSubmit({ openMandatory, toReview });
    }
    saveStatus(next);
  };

  const exportPdf = async () => {
    if (!tender) return;
    setExporting(true);
    try {
      const m = await import('../lib/exportPdf');
      m.exportChecklistPdf({ tender, companyName: company.name, userName: user.name, reqs, vault, ai: ai?.ai_fields ?? null });
    } catch (e) {
      toast(`Couldn't create the PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const openPdf = async (f: TenderFile) => {
    const { data, error: e } = await supabase.storage.from(TENDER_BUCKET).createSignedUrl(f.file_path, 60);
    if (e || !data) return toast(friendlyError(e));
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (error)
    return (
      <div className="page">
        <button className="btn ghost back" onClick={onBack}><ArrowLeft className="ico" aria-hidden="true" />Tenders</button>
        <div className="callout crit">{error}</div>
      </div>
    );
  if (!tender || !files) return <div className="page"><p className="muted">Loading…</p></div>;

  const c = tender.closing_at ? closingIn(tender.closing_at) : null;
  const docsFirst = reqs.length === 0;
  const documentsPanel = (
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
                {f.status === 'done' && <button className="btn" onClick={() => setViewing({ file: f })}>View text</button>}
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
          {totals.ocr > 0 && `, ${totals.ocr} by OCR`}.
        </div>
      )}
    </section>
  );
  return (
    <div className="page">
      <button className="btn ghost back" onClick={onBack}><ArrowLeft className="ico" aria-hidden="true" />Tenders</button>
      <div className="page-head">
        <div className="title-block">
          <div className="title-row">
            <h1>{tender.reference_no || 'Untitled tender'}</h1>
            <span className="stab big" data-tone={STATUS_TONE[tender.status]}>{TENDER_STATUS_LABEL[tender.status]}</span>
          </div>
          <p>{[tender.entity, tender.description].filter(Boolean).join(' · ') || 'Add the details on the right.'}</p>
        </div>
        <div className="head-actions">
          <label className="status-pick">
            <span>Change status</span>
            <select className="select" value={tender.status} disabled={savingStatus} onChange={(e) => changeStatus(e.target.value as TenderStatus)} aria-label="Tender status">
              {(Object.keys(TENDER_STATUS_LABEL) as TenderStatus[]).map((s) => <option key={s} value={s}>{TENDER_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <button className="btn" onClick={exportPdf} disabled={exporting}><FileDown className="ico" aria-hidden="true" />{exporting ? 'Preparing PDF…' : 'Export PDF'}</button>
          <button className="btn danger" onClick={() => setRemovingTender(true)}><Trash2 className="ico" aria-hidden="true" />Delete</button>
        </div>
      </div>

      <DeadlineBand tender={tender} ai={ai} reqs={reqs} closing={c} />

      <div className="grid g-3-1">
        <div className="main-col">
          {docsFirst && documentsPanel}
          {ai && (
            <ReviewPanel
              tender={tender}
              ai={ai}
              reqs={reqs}
              files={files}
              vault={vault}
              onRun={runAi}
              onChanged={loadReqs}
              onOpenVault={onOpenVault}
              onFillDetails={(p) => {
                setPrefill({ p, key: Date.now() });
                document.getElementById('details-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              onOpenSource={(fileId, page, quote) => {
                const f = files.find((x) => x.id === fileId);
                if (f && f.status === 'done') setViewing({ file: f, page: page ?? undefined, query: quote ?? undefined });
                else toast('That file is no longer available.');
              }}
            />
          )}
          {!docsFirst && documentsPanel}
        </div>
        <div className="side-col">
          <DetailsForm tender={tender} prefill={prefill} onSaved={(t) => { setTender(t); setPrefill(null); setRev((n) => n + 1); toast('Details saved.'); }} />
          <RemindersCard tender={tender} user={user} rev={rev} />
        </div>
      </div>

      <Activity tenderId={tender.id} rev={rev} />

      {confirmSubmit && (
        <Modal
          title="Mark as submitted?"
          onClose={() => setConfirmSubmit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSubmit(null)} disabled={savingStatus}>Keep preparing</button>
              <button className="btn primary" onClick={() => saveStatus('submitted')} disabled={savingStatus}>{savingStatus ? 'Saving…' : 'Mark as submitted'}</button>
            </>
          }
        >
          <ul className="plain-list">
            {confirmSubmit.openMandatory > 0 && <li><b>{confirmSubmit.openMandatory} mandatory document{confirmSubmit.openMandatory > 1 ? 's are' : ' is'} not ticked</b> on the checklist.</li>}
            {confirmSubmit.toReview > 0 && <li><b>{confirmSubmit.toReview} item{confirmSubmit.toReview > 1 ? 's' : ''} from the AI {confirmSubmit.toReview > 1 ? 'were' : 'was'} never reviewed.</b></li>}
          </ul>
          <p style={{ marginBottom: 0 }}>If the bid has gone in, mark it as submitted. Reminders for this tender will stop.</p>
        </Modal>
      )}

      {viewing && <TextViewer file={viewing.file} initialPage={viewing.page} initialQuery={viewing.query} onClose={() => setViewing(null)} />}
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

function DetailsForm({ tender, prefill, onSaved }: { tender: Tender; prefill: { p: DetailsPrefill; key: number } | null; onSaved: (t: Tender) => void }) {
  const [ref, setRef] = useState(tender.reference_no ?? '');
  const [entity, setEntity] = useState(tender.entity ?? '');
  const [desc, setDesc] = useState(tender.description ?? '');
  const [closing, setClosing] = useState(toLocalInput(tender.closing_at));
  const [briefing, setBriefing] = useState(toLocalInput(tender.briefing_at));
  const [compulsory, setCompulsory] = useState(tender.briefing_compulsory ? 'yes' : tender.briefing_compulsory === false ? 'no' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // "Fill tender details" from the AI results: fills the form; nothing is saved until the person clicks Save.
  useEffect(() => {
    if (!prefill) return;
    const p = prefill.p;
    if (p.reference_no) setRef(p.reference_no);
    if (p.entity) setEntity(p.entity);
    if (p.description) setDesc(p.description);
    if (p.closing_local) setClosing(p.closing_local);
    if (p.briefing_local) setBriefing(p.briefing_local);
    if (p.briefing_compulsory != null) setCompulsory(p.briefing_compulsory ? 'yes' : 'no');
  }, [prefill]);

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
      })
      .eq('id', tender.id)
      .select(TENDER_COLS)
      .single();
    setBusy(false);
    if (e || !data) return setError(friendlyError(e));
    onSaved(data as Tender);
  };

  return (
    <form className="panel" onSubmit={save} id="details-form">
      <div className="panel-head"><h2>Details</h2></div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {prefill && (
          <div className="callout warn">
            <b>Filled in from the tender documents</b>
            Check each field, then click Save details.
            {prefill.p.notes.map((n) => <span key={n} style={{ display: 'block', marginTop: 4 }}>{n}</span>)}
          </div>
        )}
        <label className="field"><span>Reference number</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} /></label>
        <label className="field"><span>Issued by</span><input className="input" value={entity} onChange={(e) => setEntity(e.target.value)} maxLength={200} /></label>
        <label className="field"><span>Short description</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></label>
        <label className="field">
          <span>Closing date and time</span>
          <input className="input" type="datetime-local" value={closing} onChange={(e) => setClosing(e.target.value)} />
          {closing && <span className="hint echo">{fmtLong(closing)}</span>}
        </label>
        <label className="field">
          <span>Briefing session</span>
          <input className="input" type="datetime-local" value={briefing} onChange={(e) => setBriefing(e.target.value)} />
          {briefing && <span className="hint echo">{fmtLong(briefing)}</span>}
        </label>
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

// ---------------------------------------------------------------- deadline band

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const TONE_OF: Record<string, string> = { crit: 'crit', warn: 'review', ok: 'ready', plain: 'slate' };

// "7 days left", "Tomorrow", "Closes in 5 h", "Closed"
function countdown(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return 'Closed';
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))} h left`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day left' : `${days} days left`;
}

const fmtLong = (local: string) =>
  new Date(local).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function DeadlineBand({ tender, ai, reqs, closing }: { tender: Tender; ai: TenderAi | null; reqs: Requirement[]; closing: ReturnType<typeof closingIn> | null }) {
  const active = ACTIVE_STATUSES.includes(tender.status);
  const briefing = tender.briefing_at ? closingIn(tender.briefing_at) : null;
  const sub = ai?.ai_fields?.fields?.submission;
  const submission = sub ? fieldValue('submission', sub) : tender.submission_method ?? '';
  const [method, ...rest] = submission.split(': ');
  const docs = reqs.filter((r) => r.confirmed && r.status !== 'not_applicable' && r.kind !== 'disqualifier' && r.kind !== 'special');
  const ticked = docs.filter((r) => r.status === 'done').length;
  const toReview = reqs.filter((r) => !r.confirmed).length;
  return (
    <section className="panel deadline-band" aria-label="Key dates">
      <div className="closing" data-tone={active && closing ? TONE_OF[closing.tone] : undefined}>
        <span className="label"><CalendarClock className="ico" aria-hidden="true" />Closing</span>
        <span className="countdown">{!tender.closing_at ? 'Not set' : active ? countdown(tender.closing_at) : TENDER_STATUS_LABEL[tender.status]}</span>
        <span className="sub">{tender.closing_at ? fmtWhen(tender.closing_at) : 'Add the closing date under Details.'}</span>
      </div>
      <div>
        <span className="label"><Users className="ico" aria-hidden="true" />Briefing</span>
        <span className="big">{tender.briefing_at ? fmtWhen(tender.briefing_at) : tender.briefing_compulsory === false ? 'Not compulsory' : 'None recorded'}</span>
        <span className="sub">
          {tender.briefing_at ? (tender.briefing_compulsory ? 'Compulsory' : tender.briefing_compulsory === false ? 'Optional' : 'Check whether it is compulsory') : '\u00a0'}
          {tender.briefing_at && active && briefing && briefing.tone !== 'plain' ? ` · ${briefing.label}` : ''}
        </span>
      </div>
      <div>
        <span className="label"><Send className="ico" aria-hidden="true" />Submission</span>
        <span className="big">{method || 'Not known yet'}</span>
        <span className="sub">{rest.join(': ') || '\u00a0'}</span>
      </div>
      <div>
        <span className="label"><ListChecks className="ico" aria-hidden="true" />Checklist</span>
        <span className="big">{docs.length ? `${ticked} of ${docs.length} prepared` : 'Not started'}</span>
        <span className="sub">
          {toReview > 0 ? <span className="warn-text">{toReview} item{toReview > 1 ? 's' : ''} to review</span> : docs.length ? <span className="meter" style={{ display: 'block', marginTop: 6 }}><i style={{ transform: `scaleX(${ticked / docs.length})` }} /></span> : 'Confirm items under Requirements.'}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- reminders

const REMINDER_LABEL: Record<string, string> = { closing: 'Closing date', briefing: 'Briefing', query_deadline: 'Question deadline', doc_expiry: 'Document expiry' };

function RemindersCard({ tender, user, rev }: { tender: Tender; user: AppUser; rev: number }) {
  const [rows, setRows] = useState<Reminder[] | null>(null);
  useEffect(() => {
    supabase
      .from('reminders')
      .select('id, kind, remind_at, sent_at, outcome, last_error')
      .eq('tender_id', tender.id)
      .order('remind_at')
      .then(({ data }) => setRows((data as Reminder[]) ?? []));
  }, [tender.id, rev]);

  const upcoming = rows?.filter((r) => !r.sent_at) ?? [];
  const sent = rows?.filter((r) => r.outcome === 'sent') ?? [];
  const failed = rows?.filter((r) => r.outcome === 'failed') ?? [];
  const active = ACTIVE_STATUSES.includes(tender.status);

  return (
    <section className="panel" aria-labelledby="rem-head">
      <div className="panel-head"><h2 id="rem-head">Email reminders</h2></div>
      <div className="panel-body rem-body">
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : !active ? (
          <p className="muted">None: this tender is {TENDER_STATUS_LABEL[tender.status]}.</p>
        ) : !user.email_reminders ? (
          <p className="muted">Reminders are off for your account. Turn them on under Company profile.</p>
        ) : upcoming.length === 0 ? (
          <p className="muted">{tender.closing_at ? 'Nothing left to send before closing.' : 'Add the closing date to get reminders.'}</p>
        ) : (
          <>
            <ul className="rem-list">
              {upcoming.map((r) => (
                <li key={r.id}>
                  <span className="mono">{fmtDateTime(r.remind_at)}</span>
                  <span>{REMINDER_LABEL[r.kind] ?? r.kind}</span>
                </li>
              ))}
            </ul>
            <p className="small muted">Sent to {user.email}.</p>
          </>
        )}
        {(sent.length > 0 || failed.length > 0) && (
          <p className="small muted">
            {sent.length > 0 && `${sent.length} sent. `}
            {failed.length > 0 && <span className="crit-text">{failed.length} couldn't be sent{failed[0].last_error ? `: ${failed[0].last_error}` : ''}.</span>}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- activity

const STATUS_WORD = TENDER_STATUS_LABEL as Record<string, string>;

function activityText(a: AuditEntry): string {
  const q = a.subject ? `"${a.subject}"` : 'an item';
  const d = a.details as Record<string, unknown>;
  switch (a.action) {
    case 'created': return 'created the tender';
    case 'added': return `added ${q}`;
    case 'confirmed': return `confirmed ${q}`;
    case 'edited': return `edited ${q}`;
    case 'ticked': return `ticked ${q} as prepared`;
    case 'unticked': return `unticked ${q}`;
    case 'not_required': return `marked ${q} as not required`;
    case 'restored': return `restored ${q}`;
    case 'deleted': return `deleted ${q}`;
    case 'status': return `changed the status from ${STATUS_WORD[String(d.from)] ?? d.from} to ${STATUS_WORD[String(d.to)] ?? d.to}`;
    case 'details': {
      const parts: string[] = [];
      if (d.closing_at) {
        const to = (d.closing_at as (string | null)[])[1];
        parts.push(to ? `the closing date to ${fmtDateTime(to)}` : 'the closing date (cleared)');
      }
      if (d.briefing_at || d.briefing_compulsory) parts.push('the briefing');
      if (d.details) parts.push('the tender details');
      return `changed ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'the tender details'}`;
    }
    default: return a.action;
  }
}

function Activity({ tenderId, rev }: { tenderId: string; rev: number }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    supabase
      .from('audit_log')
      .select('id, action, subject, details, created_at, users(name)')
      .eq('tender_id', tenderId)
      .order('id', { ascending: false })
      .limit(100)
      .then(({ data }) => setRows((data as unknown as AuditEntry[]) ?? []));
  }, [tenderId, rev]);
  if (!rows || rows.length === 0) return null;
  return (
    <details className="panel activity">
      <summary className="panel-head"><h2><ChevronRight className="ico" aria-hidden="true" />Activity</h2><span className="small muted">{rows.length} change{rows.length > 1 ? 's' : ''} by your team</span></summary>
      <ul className="activity-list">
        {rows.map((a) => (
          <li key={a.id}>
            <span className="mono small muted">{fmtDateTime(a.created_at)}</span>
            <span><b>{a.users?.name ?? 'Someone'}</b> {activityText(a)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------- text viewer

function TextViewer({ file, initialPage, initialQuery, onClose }: { file: TenderFile; initialPage?: number; initialQuery?: string; onClose: () => void }) {
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  // From a source link: search for the start of the quote, so it's highlighted on the page.
  const [q, setQ] = useState(initialQuery ? initialQuery.split(/\s+/).slice(0, 5).join(' ') : '');

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
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="ico" aria-hidden="true" /></button>
            <span className="mono">Page {page} / {max}</span>
            <button className="btn" onClick={() => setPage((p) => Math.min(max, p + 1))} disabled={page >= max} aria-label="Next page"><ChevronRight className="ico" aria-hidden="true" /></button>
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
