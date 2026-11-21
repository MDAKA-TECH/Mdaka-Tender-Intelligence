import { createContext, useContext, useState, type FormEvent } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { friendlyError, supabase } from '../lib/supabase';
import { Modal } from './ui';

// Guests (people trying the app without an account) are asked to sign up only when they reach
// something that needs an account: a second tender, the vault, reminders or the company profile.

export const SignUpCtx = createContext<(reason?: string) => void>(() => {});
export const useSignUp = () => useContext(SignUpCtx);

export function GuestBanner({ onSignUp }: { onSignUp: () => void }) {
  return (
    <div className="guest-banner" role="note">
      <Sparkles className="ico" aria-hidden="true" />
      <p>
        <b>You're trying Tender Intelligence free, without an account.</b>{' '}
        Sign up to keep this tender, add more and get deadline reminders. Trials without an account are deleted after 7 days.
      </p>
      <button className="btn primary" onClick={onSignUp}>Sign up free</button>
    </div>
  );
}

export function GuestGate({ title, body }: { title: string; body: string }) {
  const signUp = useSignUp();
  return (
    <section className="panel">
      <div className="empty-state">
        <span className="gate-icon" aria-hidden="true"><Lock className="ico" /></span>
        <b>{title}</b>
        <p className="muted">{body}</p>
        <button className="btn primary" onClick={() => signUp()}>Sign up free</button>
        <span className="small muted">Your tender and its checklist come with you.</span>
      </div>
    </section>
  );
}

const GOOGLE_TAKEN = /already (been )?(linked|registered|exists)|identity_already_exists|email_exists/i;

// Turns the guest login into a real account, keeping everything they did as a guest.
export function SignUpModal({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const google = async () => {
    setBusy('google');
    setError(null);
    const { error: e } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (e) {
      setBusy(null);
      if (GOOGLE_TAKEN.test(e.message)) return setTaken(true);
      setError(/manual linking is disabled/i.test(e.message) ? 'Signing up with Google is not switched on yet. Use your email below.' : friendlyError(e));
    }
  };

  const withEmail = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy('email');
    setError(null);
    const address = email.trim().toLowerCase();
    const { data, error: e } = await supabase.auth.updateUser({ email: address }, { emailRedirectTo: window.location.origin });
    setBusy(null);
    if (e) {
      if (GOOGLE_TAKEN.test(e.message) || /already registered/i.test(e.message)) return setTaken(true);
      return setError(friendlyError(e));
    }
    // With email confirmation off the address is already on the account; otherwise a link was sent.
    if (data.user?.email === address) {
      await supabase.auth.refreshSession();
      onClose();
    } else {
      setSentTo(address);
    }
  };

  const signInInstead = async () => {
    await supabase.auth.signOut();
    window.location.hash = '#/signin';
  };

  return (
    <Modal title="Sign up free" onClose={onClose}>
      {sentTo ? (
        <div className="signup-body">
          <div className="callout ok"><b>Check your inbox</b>We sent a link to {sentTo}. Open it to finish signing up. Your tender stays here in the meantime.</div>
          <p className="small muted" style={{ margin: 0 }}>Can't find it? Check the spam folder, or close this and try again.</p>
        </div>
      ) : taken ? (
        <div className="signup-body">
          <div className="callout warn">
            <b>You already have an account</b>
            Sign in with it instead. The tender you tried as a guest won't move across, so upload it again after signing in.
          </div>
          <div className="toolbar">
            <button className="btn primary" onClick={signInInstead}>Sign in</button>
            <button className="btn" onClick={() => setTaken(false)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="signup-body">
          <p style={{ margin: 0 }}>
            {reason ? <><b>{reason}</b> </> : null}
            Keep the tender you've uploaded, add as many as you need, use the document vault and get reminders before every deadline.
          </p>
          <button type="button" className="btn google-btn" onClick={google} disabled={!!busy}>
            <img src="/google-g.svg" alt="" width="18" height="18" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="or-line" aria-hidden="true"><span>or with email</span></div>
          <form onSubmit={withEmail} className="signup-email">
            <label className="field">
              <span>Work email</span>
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.za" required />
            </label>
            <button className="btn primary" type="submit" disabled={!!busy}>{busy === 'email' ? 'Sending…' : 'Sign up with email'}</button>
          </form>
          {error && <div className="callout crit">{error}</div>}
          <p className="small muted" style={{ margin: 0 }}>
            Already have an account? <button className="login-toggle" onClick={() => setTaken(true)}>Sign in</button>
            {' · '}By signing up you agree to the <a href="#/terms">terms</a> and <a href="#/privacy">privacy notice</a>.
          </p>
        </div>
      )}
    </Modal>
  );
}
