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
    <div className="page" style={{ maxWidth: 720 }}>
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
    </div>
  );
}
