import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Identity, Profile } from '../types';
import { fetchProfile, updateProfile } from '../lib/data';
import { publicBundle, samePublicKey } from '../lib/crypto';
import { supabase, supabaseConfigured } from '../lib/env';
import { clearIdentityMemoryCache, getOrCreateIdentity } from '../lib/identityStore';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  identity: Identity | null;
  profileError: string | null;
  hadRecoverySession: boolean;
  refreshProfile: () => Promise<Profile | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function friendlyAccountError(error: unknown): string {
  if (error instanceof Error) {
    if (/fetch|network|failed to fetch/i.test(error.message)) {
      return 'Unable to reach the server. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Unable to load your account.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState(Boolean(supabase));
  const [accountLoading, setAccountLoading] = useState(false);
  const [hadRecoverySession, setHadRecoverySession] = useState(false);
  const user = session?.user ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setProfileError(friendlyAccountError(error));
        setSession(data.session);
      })
      .catch((error: unknown) => {
        if (active) setProfileError(friendlyAccountError(error));
      })
      .finally(() => {
        if (active) setBootLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession((previous) => {
        if (previous?.user?.id && previous.user.id !== nextSession?.user?.id) {
          setProfile(null);
          setIdentity(null);
          setProfileError(null);
        }
        return nextSession;
      });
      if (event === 'PASSWORD_RECOVERY') setHadRecoverySession(true);
      if (event === 'SIGNED_OUT') {
        clearIdentityMemoryCache();
        setProfile(null);
        setIdentity(null);
        setProfileError(null);
        setAccountLoading(false);
        setHadRecoverySession(false);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    void (async () => {
      setAccountLoading(true);
      setProfileError(null);
      try {
        let loaded: Profile | null = null;
        for (let attempt = 0; attempt < 4 && active && !loaded; attempt += 1) {
          loaded = await fetchProfile(userId);
          if (!loaded) await wait(400 + attempt * 350);
        }
        if (!active) return;
        if (!loaded) {
          setProfileError(
            'Your profile could not be found. Confirm your email, then sign in again.',
          );
          return;
        }

        const deviceIdentity = await getOrCreateIdentity(userId, loaded.public_key, userEmail);
        if (!active) return;
        const bundle = publicBundle(deviceIdentity);

        if (!samePublicKey(loaded.public_key, bundle)) {
          loaded = await updateProfile(userId, { public_key: bundle });
        }
        if (!active) return;
        setIdentity(deviceIdentity);
        setProfile(loaded);
      } catch (error) {
        if (active) setProfileError(friendlyAccountError(error));
      } finally {
        if (active) setAccountLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId, userEmail]);

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    if (!userId) return null;
    try {
      const next = await fetchProfile(userId);
      if (next) setProfile(next);
      return next;
    } catch (error) {
      setProfileError(friendlyAccountError(error));
      throw error;
    }
  }, [userId]);

  const signOut = useCallback(async () => {
    clearIdentityMemoryCache();
    if (!supabase) return;
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const loading = bootLoading || Boolean(session && accountLoading);

  const value = useMemo(
    () => ({
      configured: supabaseConfigured,
      loading,
      session,
      user,
      profile,
      identity,
      profileError,
      hadRecoverySession,
      refreshProfile,
      signOut,
    }),
    [
      loading,
      session,
      user,
      profile,
      identity,
      profileError,
      hadRecoverySession,
      refreshProfile,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
