import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { supabaseConfigured } from './lib/supabase';
import type { AppUser, Company } from './lib/types';
import { ToastCtx } from './components/ui';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Vault from './pages/Vault';
import CompanyPage from './pages/Company';
import Tenders from './pages/Tenders';
import TenderDetail from './pages/TenderDetail';

type Route = { page: 'tenders' } | { page: 'tender'; id: string } | { page: 'vault' } | { page: 'company' };
type Page = Route['page'];

const NAV: { page: Page; label: string }[] = [
  { page: 'tenders', label: 'Tenders' },
  { page: 'vault', label: 'Document vault' },
  { page: 'company', label: 'Company profile' },
];

let toastTimer = 0;

export default function App() {
  const { ready, session, user, company, loadError, signOut } = useAuth();

  if (!supabaseConfigured)
    return (
      <Centered>
        <div className="callout crit">
          <b>Database not configured</b>
          The app was built without <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span>. Locally,
          put them in <span className="mono">.env.local</span> and restart <span className="mono">npm run dev</span>. On Vercel, add them under
          Settings → Environment Variables, then redeploy.
        </div>
      </Centered>
    );
  if (!ready) return <Centered><p className="muted">Loading…</p></Centered>;
  if (!session) return <Login />;
  if (loadError)
    return (
      <Centered>
        <div className="callout crit">
          <b>Couldn't load your workspace</b>
          {loadError}
        </div>
        <button className="btn" onClick={signOut}>Sign out</button>
      </Centered>
    );
  if (!user) return <Onboarding />;
  if (!company) return <Centered><p className="muted">Loading your workspace…</p></Centered>;
  return <Shell user={user} company={company} key={user.id} />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="page" style={{ maxWidth: 520, paddingTop: 80 }}>
      {children}
    </div>
  );
}

function Shell({ user, company }: { user: AppUser; company: Company }) {
  const { signOut } = useAuth();
  const [route, setRoute] = useState<Route>({ page: 'tenders' });
  const go = (r: Route) => {
    setRoute(r);
    document.querySelector('.main')?.scrollTo(0, 0);
  };
  const active: Page = route.page === 'tender' ? 'tenders' : route.page;
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = useMemo(
    () => (m: string) => {
      setToastMsg(m);
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => setToastMsg(null), 3200);
    },
    [],
  );

  return (
    <ToastCtx.Provider value={toast}>
      <div className="app">
        <aside className="rail">
          <div className="brand">
            <b>
              Tender <span className="ti">Intelligence</span>
            </b>
            <small>Mdaka Advanced Technologies</small>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.label} aria-current={n.page === active ? 'page' : undefined} onClick={() => go({ page: n.page } as Route)}>
                {n.label}
              </button>
            ))}
          </nav>
          <div className="whoami">
            <div className="me">
              <b>{user.name}</b>
              <span>{company.name}</span>
            </div>
            <button className="btn rail-btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          {route.page === 'tenders' ? (
            <Tenders company={company} onOpen={(id) => go({ page: 'tender', id })} />
          ) : route.page === 'tender' ? (
            <TenderDetail id={route.id} key={route.id} company={company} onBack={() => go({ page: 'tenders' })} />
          ) : route.page === 'vault' ? (
            <Vault company={company} />
          ) : (
            <CompanyPage company={company} user={user} />
          )}
        </main>
      </div>
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
