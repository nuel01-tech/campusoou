import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session as AuthSession, User } from '@supabase/supabase-js';
import { getAuthSession, getMyProfile, onAuthChange, signOut, type Role } from '@/services/auth';
import type { Profile } from '@/types';

interface AuthState {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  role: Role | null;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  ready: false,
  user: null,
  profile: null,
  role: null,
  refreshAuth: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const syncSession = useCallback(async (s: AuthSession | null) => {
    setSession(s);
    const user = s?.user ?? null;
    if (!user || user.is_anonymous) {
      setProfile(null);
      setReady(true);
      return;
    }
    try {
      const p = await getMyProfile(user.id);
      if (p && !p.active) {
        await signOut().catch(() => {});
        setSession(null);
        setProfile(null);
      } else {
        setProfile(p);
      }
    } catch {
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    const s = await getAuthSession().catch(() => null);
    await syncSession(s);
  }, [syncSession]);

  useEffect(() => {
    let active = true;
    getAuthSession()
      .then((s) => {
        if (active) void syncSession(s);
      })
      .catch(() => {
        if (active) setReady(true);
      });

    const unsubscribe = onAuthChange((s) => {
      if (active) void syncSession(s);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [syncSession]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    const role: Role | null = !user ? null : user.is_anonymous ? 'student' : (profile?.role ?? null);
    return { ready, user, profile, role, refreshAuth };
  }, [ready, session, profile, refreshAuth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
