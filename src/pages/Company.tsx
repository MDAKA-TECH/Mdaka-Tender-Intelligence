import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import type { AppUser, Company } from '../lib/types';
import { useToast } from '../components/ui';

export default function CompanyPage({ company, user }: { company: Company; user: AppUser }) {
  const { reload } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(company.name);
  const [csd, setCsd] = useState(company.csd_supplier_no ?? '');
  const [level, setLevel] = useState(company.bbbee_level ? String(company.bbbee_level) : '');
  const [person, setPerson] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const c = await supabase
      .from('companies')
      .update({ name: name.trim(), csd_supplier_no: csd.trim().toUpperCase() || null, bbbee_level: level ? Number(level) : null })
      .eq('id', company.id);
    const u = c.error ? c : await supabase.from('users').update({ name: person.trim() }).eq('id', user.id);
    setBusy(false);
    if (u.error) return setError(friendlyError(u.error));
    toast('Profile saved.');
    await reload();
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Company profile</h1>
          <p>Used to pre-fill SBD forms and to match tender requirements.</p>
        </div>
      </div>
      <form className="panel" onSubmit={save}>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            <span>Company name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>CSD supplier number</span>
              <input className="input mono" value={csd} onChange={(e) => setCsd(e.target.value)} placeholder="MAAA1234567" pattern="[Mm][Aa][Aa][Aa]\d{7}" />
            </label>
            <label className="field">
              <span>B-BBEE level</span>
              <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>Level {n}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Your name</span>
            <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} required />
          </label>
          <p className="hint" style={{ margin: 0 }}>Signed in as {user.email}</p>
          {error && <div className="callout crit">{error}</div>}
          <div>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>

      <Notifications user={user} onChanged={reload} />
    </div>
  );
}

const MAX_RECIPIENTS = 3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Recipient { id: string; email: string; name: string | null }

// Who gets the reminder emails: up to 3 addresses per company, each editable to fix a typo.
function Notifications({ user }: { user: AppUser; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('reminder_recipients').select('id, email, name').order('created_at');
    if (error) return setLoadError(friendlyError(error));
    setLoadError(null);
    setRows((data as Recipient[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (r: { id?: string; email: string; name: string }): Promise<string | null> => {
    const email = r.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return 'Enter a full email address, like tenders@yourcompany.co.za.';
    if (rows?.some((x) => x.id !== r.id && x.email === email)) return 'That address is already on the list.';
    const patch = { email, name: r.name.trim() || null };
    const { error } = r.id
      ? await supabase.from('reminder_recipients').update(patch).eq('id', r.id)
      : await supabase.from('reminder_recipients').insert(patch);
    if (error) return friendlyError(error);
    setEditing(null);
    setResult(null);
    toast(r.id ? 'Email address updated.' : 'Email address added.');
    load();
    return null;
  };

  const remove = async (r: Recipient) => {
    const { error } = await supabase.from('reminder_recipients').delete().eq('id', r.id);
    if (error) return toast(friendlyError(error));
    toast(`${r.email} removed.`);
    setResult(null);
    load();
  };

  const sendTest = async () => {
    setTesting(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke('send-reminders', { body: { mode: 'test' } });
    setTesting(false);
    if (error) {
      // The function's own message is in the response body.
      let text = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) text = body.error;
      } catch {
        /* keep the generic message */
      }
      if (/Failed to send a request|FunctionsFetchError/i.test(text)) text = 'The send-reminders function is not deployed yet (see the README, week 5).';
      return setResult({ ok: false, text });
    }
    setResult({ ok: true, text: `Test email sent to ${data.sent_to}. Check each inbox (and the spam folder).` });
  };

  const count = rows?.length ?? 0;
  return (
    <section className="panel" aria-labelledby="notif-head">
      <div className="panel-head">
        <h2 id="notif-head">Email reminders</h2>
        {rows && <span className="small muted">{count} of {MAX_RECIPIENTS} addresses</span>}
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Reminders go to every address below, up to {MAX_RECIPIENTS}. Use anyone who needs them: a colleague, your bookkeeper or a shared tenders inbox. They don't need an account.
        </p>
        {loadError && (
          <div className="callout crit">
            <b>Couldn't load the reminder addresses</b>
            {loadError} If it mentions a table that does not exist, run the latest file in supabase/migrations in the Supabase SQL editor.
          </div>
        )}
        {rows && (
          <ul className="recipients">
            {rows.map((r) =>
              editing === r.id ? (
                <li key={r.id}><RecipientForm initial={r} onSave={(v) => save({ ...v, id: r.id })} onCancel={() => setEditing(null)} /></li>
              ) : (
                <li key={r.id} className="recipient">
                  <div className="who">
                    <b>{r.name || r.email}</b>
                    {r.name && <span className="small muted">{r.email}</span>}
                    {r.email === user.email.toLowerCase() && <span className="small muted">Your sign-in email</span>}
                  </div>
                  <div className="toolbar">
                    <button className="btn" onClick={() => setEditing(r.id)} disabled={editing !== null}>Edit</button>
                    <button className="btn ghost icon" onClick={() => remove(r)} disabled={editing !== null} aria-label={`Remove ${r.email}`} title="Remove"><Trash2 className="ico" aria-hidden="true" /></button>
                  </div>
                </li>
              ),
            )}
            {editing === 'new' && <li><RecipientForm initial={null} onSave={(v) => save(v)} onCancel={() => setEditing(null)} /></li>}
          </ul>
        )}
        {rows && count === 0 && editing !== 'new' && (
          <div className="callout warn"><b>Reminders are off</b>No addresses on the list, so no reminder emails are sent. Add one to turn them on.</div>
        )}
        {rows && (
          <div className="toolbar">
            {count < MAX_RECIPIENTS && editing === null && (
              <button className="btn" onClick={() => setEditing('new')}><Plus className="ico" aria-hidden="true" />Add email address</button>
            )}
            <button className="btn" onClick={sendTest} disabled={testing || count === 0 || editing !== null}>{testing ? 'Sending…' : count > 1 ? `Send test email to all ${count}` : 'Send test email'}</button>
          </div>
        )}
        {result && <div className={`callout ${result.ok ? 'ok' : 'crit'}`}>{result.text}</div>}
        <ul className="plain-list small muted">
          <li>Closing dates: 7 days before, 2 days before, and on the morning of the closing day</li>
          <li>Briefings: 2 days before and on the morning (unless marked optional)</li>
          <li>Vault documents: 30, 7 and 1 day before they expire</li>
          <li>Only for tenders that are Reviewing or Preparing. Emails go out at about 08:00 (South African time).</li>
        </ul>
      </div>
    </section>
  );
}

function RecipientForm({ initial, onSave, onCancel }: {
  initial: Recipient | null;
  onSave: (v: { email: string; name: string }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(initial?.email ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    const err = await onSave({ email, name });
    setBusy(false);
    setError(err);
  };
  return (
    <form className="recipient-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          <span>Name <span className="muted">(optional)</span></span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Thandi, or Tenders inbox" autoFocus={!!initial} />
        </label>
        <label className="field">
          <span>Email address</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="tenders@yourcompany.co.za" required autoFocus={!initial} />
        </label>
      </div>
      {error && <div className="callout crit small">{error}</div>}
      <div className="toolbar">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add'}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
