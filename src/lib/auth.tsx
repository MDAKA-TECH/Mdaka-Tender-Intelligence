import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { friendlyError, supabase } from './supabase';
import type { AppUser, Company } from './types';

interface AuthState {
  ready: boolean;
  session: Session | null;
  user: AppUser | null;       // null after sign-in = needs onboarding
  company: Company | null;
  loadError: string | null;
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

  const loadProfile = useCallback(async (s: Session | null) => {
    setLoadError(null);
    if (!s) {
      setUser(null);
      setCompany(null);
      return;
    }
    const { data: u, error } = await supabase.from('users').select('id, company_id, email, name').eq('id', s.user.id).maybeSingle();
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

  const value: AuthState = {
    ready,
    session,
    user,
    company,
    loadError,
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
