import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, FolderLock, Layers, LogOut, type LucideIcon } from 'lucide-react';
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

const NAV: { page: Page; label: string; short: string; icon: LucideIcon }[] = [
  { page: 'tenders', label: 'Tenders', short: 'Tenders', icon: Layers },
  { page: 'vault', label: 'Document vault', short: 'Vault', icon: FolderLock },
  { page: 'company', label: 'Company profile', short: 'Company', icon: Building2 },
];

let toastTimer = 0;

// Hash routes, so links in reminder emails open the right page: #/tenders/<id>, #/vault, #/company.
function parseHash(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'tenders' && b && /^[0-9a-f-]{36}$/i.test(b)) return { page: 'tender', id: b };
  if (a === 'vault') return { page: 'vault' };
  if (a === 'company') return { page: 'company' };
  return { page: 'tenders' };
}
const toHash = (r: Route) => (r.page === 'tender' ? `#/tenders/${r.id}` : `#/${r.page}`);

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
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      document.querySelector('.main')?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (r: Route) => {
    if (window.location.hash !== toHash(r)) window.location.hash = toHash(r);
    else setRoute(r);
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
            <small>by Mdaka Advanced Technologies</small>
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.label} aria-current={n.page === active ? 'page' : undefined} onClick={() => go({ page: n.page } as Route)}>
                <n.icon className="ico" aria-hidden="true" />
                <span className="long">{n.label}</span>
                <span className="short">{n.short}</span>
              </button>
            ))}
          </nav>
          <div className="whoami">
            <div className="me">
              <b>{user.name}</b>
              <span>{company.name}</span>
            </div>
            <button className="btn rail-btn" onClick={signOut}>
              <LogOut className="ico" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          {route.page === 'tenders' ? (
            <Tenders company={company} onOpen={(id) => go({ page: 'tender', id })} onOpenVault={() => go({ page: 'vault' })} />
          ) : route.page === 'tender' ? (
            <TenderDetail id={route.id} key={route.id} company={company} user={user} onBack={() => go({ page: 'tenders' })} onOpenVault={() => go({ page: 'vault' })} />
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
