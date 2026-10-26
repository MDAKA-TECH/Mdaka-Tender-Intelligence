import { useState, type FormEvent } from 'react';
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

function Notifications({ user, onChanged }: { user: AppUser; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [on, setOn] = useState(user.email_reminders);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    const { error } = await supabase.from('users').update({ email_reminders: next }).eq('id', user.id);
    setSaving(false);
    if (error) {
      setOn(!next);
      return toast(friendlyError(error));
    }
    toast(next ? 'Email reminders on.' : 'Email reminders off.');
    await onChanged();
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
    setResult({ ok: true, text: `Test email sent to ${data.sent_to}. Check your inbox (and spam folder).` });
  };

  return (
    <section className="panel" aria-labelledby="notif-head">
      <div className="panel-head"><h2 id="notif-head">Email reminders</h2></div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="check-inline">
          <input type="checkbox" checked={on} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          Email me deadline reminders at <b>{user.email}</b>
        </label>
        <ul className="plain-list small muted">
          <li>Closing dates: 7 days before, 2 days before, and on the morning of the closing day</li>
          <li>Briefings: 2 days before and on the morning (unless marked optional)</li>
          <li>Vault documents: 30, 7 and 1 day before they expire</li>
          <li>Only for tenders that are Reviewing or Preparing. Emails go out at about 08:00 (South African time).</li>
        </ul>
        <div>
          <button className="btn" onClick={sendTest} disabled={testing || !on}>{testing ? 'Sending…' : 'Send test email'}</button>
        </div>
        {result && <div className={`callout ${result.ok ? 'ok' : 'crit'}`}>{result.text}</div>}
      </div>
    </section>
  );
}
