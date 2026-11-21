import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';
import { usePageTitle } from '../components/ui';

// Shown once, right after a guest signs up: name the company (and set a password for email sign-ups).
export default function FinishSignup() {
  usePageTitle('Finish signing up');
  const { session, reload, signOut } = useAuth();
  const meta = session?.user.user_metadata ?? {};
  const viaGoogle = session?.user.identities?.some((i) => i.provider === 'google') ?? false;
  const [company, setCompany] = useState('');
  const [person, setPerson] = useState(String(meta.full_name ?? meta.name ?? ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    if (!viaGoogle) {
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) {
        setBusy(false);
        return setError(friendlyError(e));
      }
    }
    const { error: e } = await supabase.rpc('finish_signup', { p_company: company, p_person: person });
    if (e) {
      setBusy(false);
      return setError(friendlyError(e));
    }
    await reload();
  };

  return (
    <div className="login">
      <div className="login-card panel" style={{ maxWidth: 480 }}>
        <form className="panel-body" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <img className="login-mark" src="/favicon.svg" alt="" width="44" height="44" />
          <div>
            <h1>You're signed up</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Signed in as {session?.user.email}. Your tender is saved. One last step:
            </p>
          </div>
          <label className="field">
            <span>Company name</span>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} required minLength={2} maxLength={200} placeholder="As registered on CSD" autoFocus />
          </label>
          <label className="field">
            <span>Your name</span>
            <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} required maxLength={120} />
          </label>
          {!viaGoogle && (
            <label className="field">
              <span>Choose a password</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <span className="hint">At least 8 characters. You'll use it with your email to sign in.</span>
            </label>
          )}
          {error && <div className="callout crit">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving…' : 'Go to my tender'}</button>
          <button type="button" className="login-toggle small" onClick={signOut} style={{ alignSelf: 'flex-start' }}>Not you? Sign out</button>
        </form>
      </div>
    </div>
  );
}
