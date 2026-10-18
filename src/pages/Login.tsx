import { useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (e) throw e;
        // With email confirmation on (Supabase default) there is no session until the link is clicked.
        if (!data.session) {
          setNotice(`We sent a confirmation link to ${email.trim()}. Open it, then sign in.`);
          setMode('signin');
        }
      }
    } catch (err) {
      setError(friendlyError(err as Error));
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === 'signup';
  return (
    <div className="login">
      <div className="login-card panel">
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="login-brand">
              Tender <span>Intelligence</span>
            </div>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {signup ? 'Create an account for your company.' : 'Sign in to prepare your bids.'}
            </p>
          </div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {signup && <span className="hint">At least 8 characters.</span>}
            </label>
            {error && <div className="callout crit">{error}</div>}
            {notice && <div className="callout">{notice}</div>}
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="small muted" style={{ margin: 0 }}>
            {signup ? 'Already have an account? ' : 'New here? '}
            <button className="login-toggle" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
