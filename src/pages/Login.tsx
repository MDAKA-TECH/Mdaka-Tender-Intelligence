import { useState, type FormEvent } from 'react';
import { friendlyError, supabase } from '../lib/supabase';
import { usePageTitle } from '../components/ui';

type Mode = 'signin' | 'signup';

// If Google sign-in was cancelled or refused, Supabase sends the person back with the reason in the URL.
function oauthError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search);
  const d = params.get('error_description') || params.get('error');
  if (!d) return null;
  history.replaceState(null, '', window.location.pathname);
  if (/provider is not enabled|Unsupported provider/i.test(d)) return 'Google sign-in is not switched on yet. Use your email and password for now.';
  if (/access_denied|cancel/i.test(d)) return 'Google sign-in was cancelled.';
  return `Google sign-in didn't work: ${d.replace(/\+/g, ' ')}`;
}
// Read once when the app loads, before anything else changes the URL.
const initialOauthError = oauthError();

export default function Login() {
  usePageTitle(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialOauthError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Leaves the app for Google's sign-in page; Supabase brings the person back here signed in.
  const google = async () => {
    setGoogleBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (e) {
      setGoogleBusy(false);
      setError(/provider is not enabled|Unsupported provider/i.test(e.message) ? 'Google sign-in is not switched on yet. Use your email and password for now.' : friendlyError(e));
    }
  };

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
            <img className="login-mark" src="/favicon.svg" alt="" width="44" height="44" />
            <div className="login-brand">
              Tender <span>Intelligence</span>
            </div>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {signup ? 'Create an account for your company.' : 'Sign in to prepare your bids.'}
            </p>
          </div>
          <button type="button" className="btn google-btn" onClick={google} disabled={googleBusy || busy}>
            <img src="/google-g.svg" alt="" width="18" height="18" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            {googleBusy ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="or-line" aria-hidden="true"><span>or with email</span></div>
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
          <p className="small muted" style={{ margin: 0 }}>
            {signup ? 'By creating an account you agree to the ' : ''}<a href="#/terms">{signup ? 'terms of use' : 'Terms of use'}</a>{signup ? ' and ' : ' · '}<a href="#/privacy">{signup ? 'privacy notice' : 'Privacy notice'}</a>{signup ? '.' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
