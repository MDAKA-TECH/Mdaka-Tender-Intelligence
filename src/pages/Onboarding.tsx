import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { friendlyError, supabase } from '../lib/supabase';

export default function Onboarding() {
  const { reload, signOut, session } = useAuth();
  const [name, setName] = useState('');
  const [person, setPerson] = useState('');
  const [csd, setCsd] = useState('');
  const [level, setLevel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('create_company', {
      p_name: name,
      p_person_name: person,
      p_csd: csd.trim() || null,
      p_bbbee: level ? Number(level) : null,
    });
    if (e) {
      setError(friendlyError(e));
      setBusy(false);
      return;
    }
    await reload();
  };

  return (
    <div className="login">
      <div className="login-card panel" style={{ maxWidth: 480 }}>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h1>Set up your company</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Signed in as {session?.user.email}. You can change these later.
            </p>
          </div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="field">
              <span>Company name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="organization" />
            </label>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} required autoComplete="name" />
            </label>
            <label className="field">
              <span>CSD supplier number (optional)</span>
              <input className="input mono" value={csd} onChange={(e) => setCsd(e.target.value)} placeholder="MAAA1234567" pattern="[Mm][Aa][Aa][Aa]\d{7}" />
            </label>
            <label className="field">
              <span>B-BBEE level (optional)</span>
              <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    Level {n}
                  </option>
                ))}
              </select>
            </label>
            {error && <div className="callout crit">{error}</div>}
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? 'Creating…' : 'Create company'}
            </button>
          </form>
          <button className="btn ghost" onClick={signOut} style={{ alignSelf: 'flex-start' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
