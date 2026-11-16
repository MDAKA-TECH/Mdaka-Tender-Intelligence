import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { friendlyError, supabase } from '../lib/supabase';
import type { TenderQuestion } from '../lib/types';
import { fmtDateTime } from '../lib/dates';
import { useToast } from './ui';

// Ask a question about the tender; the worker answers from the documents only, with the pages it used.

const COLS = 'id, question, status, answer, found, citations, error, error_kind, created_at, answered_at';
const POLL_MS = 3000;
const EXAMPLES = ['Is the briefing session compulsory?', 'What is the validity period of the bid?', 'Which SBD forms must be returned?', 'How are price and B-BBEE points split?'];

const FAILED: Record<string, string> = {
  busy: 'The AI service was busy. Ask again in a few minutes.',
  account: "AI answers are paused for your account. We've been notified.",
  input: 'This tender has no read documents yet. Add them and wait for them to be read.',
};

export default function AskPanel({ tenderId, canAsk, where, onOpenSource }: {
  tenderId: string;
  canAsk: boolean;
  where: (fileId: string | null, page: number | null) => string;
  onOpenSource: (fileId: string | null, page: number | null, quote: string | null) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<TenderQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tender_questions').select(COLS).eq('tender_id', tenderId).order('created_at', { ascending: false }).limit(50);
    if (error) return setLoadError(friendlyError(error));
    setLoadError(null);
    setRows((data as TenderQuestion[]) ?? []);
  }, [tenderId]);

  useEffect(() => { load(); }, [load]);

  const waiting = rows?.some((r) => r.status === 'queued' || r.status === 'answering') ?? false;
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  const ask = async (e?: FormEvent, text = q) => {
    e?.preventDefault();
    const question = text.trim();
    if (question.length < 3) return;
    setSending(true);
    const { error } = await supabase.from('tender_questions').insert({ tender_id: tenderId, question: question.slice(0, 500) });
    setSending(false);
    if (error) return toast(friendlyError(error));
    setQ('');
    load();
  };

  const remove = async (r: TenderQuestion) => {
    const { error } = await supabase.from('tender_questions').delete().eq('id', r.id);
    if (error) return toast(friendlyError(error));
    setRows((xs) => xs?.filter((x) => x.id !== r.id) ?? null);
  };

  if (loadError)
    return (
      <div className="callout crit">
        <b>Couldn't load questions</b>
        {loadError} If it mentions a table that does not exist, run the latest file in supabase/migrations in the Supabase SQL editor.
      </div>
    );

  return (
    <div className="ask">
      <form className="ask-form" onSubmit={ask}>
        <label htmlFor="ask-input" className="sr-only">Your question about this tender</label>
        <textarea
          id="ask-input"
          className="input"
          rows={2}
          maxLength={500}
          placeholder={canAsk ? 'Ask about this tender, e.g. what must be in the returnable envelope?' : 'Add the tender documents first, then ask about them.'}
          value={q}
          disabled={!canAsk}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <button className="btn primary" disabled={!canAsk || sending || q.trim().length < 3}>{sending ? 'Asking…' : 'Ask'}</button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>
        Answers come only from this tender's documents, with the pages they're from. Check the page before you rely on an answer: it isn't legal advice.
      </p>

      {rows && rows.length === 0 && canAsk && (
        <div className="ask-examples">
          <span className="small muted">Try:</span>
          {EXAMPLES.map((x) => <button key={x} className="btn ghost chip" onClick={() => ask(undefined, x)} disabled={sending}>{x}</button>)}
        </div>
      )}

      {!rows ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ul className="qa-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="qa-q">
                <b>{r.question}</b>
                <button className="btn ghost icon" onClick={() => remove(r)} aria-label="Delete question" title="Delete question"><Trash2 className="ico" aria-hidden="true" /></button>
              </div>
              {(r.status === 'queued' || r.status === 'answering') && (
                <p className="muted small" style={{ margin: 0 }}><span className="pill accent">{r.status === 'answering' ? 'Reading the documents…' : 'Waiting'}</span></p>
              )}
              {r.status === 'failed' && <div className="callout warn small">{FAILED[r.error_kind ?? ''] ?? 'Something went wrong answering this. Delete it and ask again.'}</div>}
              {r.status === 'done' && (
                <>
                  {r.found === false && <span className="pill warn">Not stated in the documents</span>}
                  <p className="qa-a">{r.answer}</p>
                  {r.citations.length > 0 && (
                    <div className="qa-cites">
                      {r.citations.map((c, i) => (
                        <button
                          key={i}
                          className="btn ghost cite"
                          disabled={!c.file_id || !c.page}
                          onClick={() => onOpenSource(c.file_id, c.page, c.quote)}
                          title={c.quote}
                        >
                          {where(c.file_id, c.page) || 'Source'}
                          {!c.verified && <span className="pill crit">Quote not found</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="small muted">{fmtDateTime(r.answered_at ?? r.created_at)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
