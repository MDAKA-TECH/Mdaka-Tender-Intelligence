import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, FolderLock, Layers, LogOut, type LucideIcon } from 'lucide-react';
import { useAuth } from './lib/auth';
import { supabaseConfigured } from './lib/supabase';
import type { AppUser, Company } from './lib/types';
import { BootMark, ToastCtx } from './components/ui';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Vault from './pages/Vault';
import CompanyPage from './pages/Company';
import Tenders from './pages/Tenders';
import TenderDetail from './pages/TenderDetail';
import Legal from './pages/Legal';
import GuestStart from './pages/GuestStart';
import FinishSignup from './pages/FinishSignup';
import { GuestBanner, GuestGate, SignUpCtx, SignUpModal } from './components/guest';

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

// #/privacy and #/terms open without signing in.
const legalPage = (h: string): 'privacy' | 'terms' | null => (h === '#/privacy' ? 'privacy' : h === '#/terms' ? 'terms' : null);
function useHash() {
  const [h, setH] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setH(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export default function App() {
  const { ready, session, user, company, loadError, signOut, isGuest, guestBusy } = useAuth();
  const hash = useHash();
  const legal = legalPage(hash);
  if (legal) return <Legal page={legal} />;

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
  if (!ready) return <BootMark />;
  if (guestBusy) return <BootMark label={guestBusy} text={guestBusy} />;
  // No account yet: start on the try-it page; #/signin and #/signup open the login screen.
  if (!session) return hash === '#/signin' || hash === '#/signup' ? <Login initialMode={hash === '#/signup' ? 'signup' : 'signin'} /> : <GuestStart />;
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
  if (!user) return isGuest ? <GuestStart /> : <Onboarding />;
  if (!company) return <BootMark label="Loading your workspace" />;
  // A guest who has just signed up (Google or a confirmed email) names their company first.
  if (!isGuest && !user.email && session.user.email) return <FinishSignup />;
  return <Shell user={user} company={company} key={user.id} />;
}

function GuestPage({ title, gate, body }: { title: string; gate: string; body: string }) {
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>{title}</h1></div></div>
      <GuestGate title={gate} body={body} />
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="page" style={{ maxWidth: 520, paddingTop: 80 }}>
      {children}
    </div>
  );
}

function Shell({ user, company }: { user: AppUser; company: Company }) {
  const { signOut, isGuest } = useAuth();
  const [signUp, setSignUp] = useState<{ reason?: string } | null>(null);
  const openSignUp = useMemo(() => (reason?: string) => setSignUp({ reason }), []);
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
  // The tender page sets its own title (its reference number).
  const navTitle = NAV.find((n) => n.page === route.page)?.label;
  useEffect(() => {
    if (navTitle) document.title = `${navTitle} · Tender Intelligence`;
  }, [navTitle]);
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
    <SignUpCtx.Provider value={openSignUp}>
      <div className="app">
        <aside className="rail">
          <div className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="" width="34" height="34" />
            <div className="brand-text">
              <b>
                Tender <span className="ti">Intelligence</span>
              </b>
              <small>by Mdaka Tech</small>
            </div>
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
            {isGuest ? (
              <>
                <div className="me">
                  <b>Free trial</b>
                  <span>No account yet</span>
                </div>
                <button className="btn primary rail-signup" onClick={() => openSignUp()}>Sign up free</button>
              </>
            ) : (
              <>
                <div className="me">
                  <b>{user.name}</b>
                  <span>{company.name}</span>
                </div>
                <button className="btn rail-btn" onClick={signOut}>
                  <LogOut className="ico" aria-hidden="true" />
                  Sign out
                </button>
              </>
            )}
            <div className="rail-legal small"><a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a></div>
          </div>
        </aside>
        <main className="main">
          {isGuest && <GuestBanner onSignUp={() => openSignUp()} />}
          {route.page === 'tenders' ? (
            <Tenders company={company} onOpen={(id) => go({ page: 'tender', id })} onOpenVault={() => go({ page: 'vault' })} />
          ) : route.page === 'tender' ? (
            <TenderDetail id={route.id} key={route.id} company={company} user={user} onBack={() => go({ page: 'tenders' })} onOpenVault={() => go({ page: 'vault' })} />
          ) : route.page === 'vault' ? (
            isGuest ? (
              <GuestPage title="Document vault" gate="Sign up to use the document vault" body="Keep your tax PIN, CSD report, B-BBEE certificate and other compliance documents in one place. Every checklist shows what you already have, and you get an email before anything expires." />
            ) : (
              <Vault company={company} />
            )
          ) : isGuest ? (
            <GuestPage title="Company profile" gate="Sign up to set up your company" body="Add your company details and choose who gets the deadline reminder emails, up to three people." />
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
      {signUp && isGuest && <SignUpModal reason={signUp.reason} onClose={() => setSignUp(null)} />}
    </SignUpCtx.Provider>
    </ToastCtx.Provider>
  );
}
