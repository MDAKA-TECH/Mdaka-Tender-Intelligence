import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { friendlyError, supabase } from './supabase';
import { sampleTenderFile, uploadTenderFiles } from './tenderFiles';
import type { AppUser, Company } from './types';

interface AuthState {
  ready: boolean;
  session: Session | null;
  user: AppUser | null;       // null after sign-in = needs onboarding
  company: Company | null;
  loadError: string | null;
  isGuest: boolean;            // trying the app without an account (Supabase anonymous login)
  guestBusy: string | null;    // what the guest start-up is doing, while it runs
  guestError: string | null;
  startAsGuest: (files: File[] | 'sample') => Promise<void>;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    setLoadError(null);
    if (!s) {
      setUser(null);
      setCompany(null);
      return;
    }
    const { data: u, error } = await supabase.from('users').select('id, company_id, email, name, email_reminders').eq('id', s.user.id).maybeSingle();
    if (error) return setLoadError(friendlyError(error));
    setUser(u);
    if (!u) return setCompany(null);
    const { data: c, error: cErr } = await supabase.from('companies').select('id, name, csd_supplier_no, bbbee_level').eq('id', u.company_id).single();
    if (cErr) return setLoadError(friendlyError(cErr));
    setCompany(c);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Token refreshes don't change who is signed in; skip the reload.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: Supabase warns against awaiting queries inside this callback.
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // A visitor's first upload: guest login, placeholder company, the tender and its files, then open it.
  // Lives here (not in a page) because the screens change underneath it while it runs.
  const startAsGuest = useCallback(async (files: File[] | 'sample') => {
    setGuestError(null);
    setGuestBusy('Setting up your free trial…');
    try {
      const list = files === 'sample' ? [await sampleTenderFile()] : files;
      let s = (await supabase.auth.getSession()).data.session;
      if (!s) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw new Error(/anonymous sign-ins are disabled/i.test(error.message) ? 'Trying without an account is not switched on yet. Create an account to continue.' : friendlyError(error));
        s = data.session;
      }
      const { data: me } = await supabase.from('users').select('id').eq('id', s!.user.id).maybeSingle();
      if (!me) {
        const { error } = await supabase.rpc('create_company', { p_name: 'My company', p_person_name: 'Guest' });
        if (error) throw new Error(friendlyError(error));
      }
      const { data: cu } = await supabase.from('users').select('company_id').eq('id', s!.user.id).single();
      const { data: t, error: tErr } = await supabase
        .from('tenders')
        .insert({ status: 'reviewing', description: files === 'sample' ? 'Sample tender: try the app with a real RFQ' : null })
        .select('id')
        .single();
      if (tErr || !t) throw new Error(friendlyError(tErr));
      setGuestBusy(`Uploading ${list.length} document${list.length > 1 ? 's' : ''}…`);
      const { failed } = await uploadTenderFiles(cu!.company_id, t.id, list);
      if (failed.length === list.length) throw new Error(`The upload failed: ${failed[0].error}`);
      window.location.hash = `#/tenders/${t.id}`;
      await loadProfile(s);
    } catch (e) {
      setGuestError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuestBusy(null);
    }
  }, [loadProfile]);

  const value: AuthState = {
    ready,
    session,
    user,
    company,
    loadError,
    isGuest: Boolean(session?.user?.is_anonymous),
    guestBusy,
    guestError,
    startAsGuest,
    reload: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
