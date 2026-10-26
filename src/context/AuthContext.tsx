import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Identity, Profile } from '../types';
import { fetchProfile, updateProfile } from '../lib/data';
import { publicBundle, samePublicKey } from '../lib/crypto';
import { supabase, supabaseConfigured } from '../lib/env';
import {
  clearIdentityMemoryCache,
  createVaultedIdentity,
  getOrCreateIdentity,
  loadIdentity,
  restoreIdentityFromVault,
} from '../lib/identityStore';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  identity: Identity | null;
  vaultLocked: boolean;
  profileError: string | null;
  hadRecoverySession: boolean;
  stageLoginPassword: (email: string, password: string) => void;
  unlockKeyVault: (password: string) => Promise<boolean>;
  rotateIdentityWithPassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Ephemeral in-memory password handoff between AuthPage.signIn and AuthProvider's
// session listener; entries self-wipe immediately on read or after 20 seconds.
const stagedPasswords = new Map<string, { password: string; expiresAt: number }>();

function setStagedPassword(email: string, password: string): void {
  const key = email.trim().toLowerCase();
  stagedPasswords.set(key, { password, expiresAt: Date.now() + 20_000 });
}

function consumeStagedPassword(email: string | null): string | null {
  if (!email) return null;
  const key = email.trim().toLowerCase();
  const entry = stagedPasswords.get(key);
  stagedPasswords.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.password;
}

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
  const [vaultLocked, setVaultLocked] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [bootLoading, setBootLoading] = useState(Boolean(supabase));
  const [accountLoading, setAccountLoading] = useState(false);
  const [hadRecoverySession, setHadRecoverySession] = useState(false);
  const user = session?.user ?? null;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  const stageLoginPassword = useCallback((email: string, password: string) => {
    setStagedPassword(email, password);
  }, []);

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
          setVaultLocked(false);
          setProfileError(null);
        }
        return nextSession;
      });
      if (event === 'PASSWORD_RECOVERY') setHadRecoverySession(true);
      if (event === 'SIGNED_OUT') {
        clearIdentityMemoryCache();
        stagedPasswords.clear();
        setProfile(null);
        setIdentity(null);
        setVaultLocked(false);
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

        const stagedPassword = consumeStagedPassword(userEmail);

        // 1. Check if this device already holds the matching identity (or staged signup slot).
        const existingLocal = await loadIdentity(userId);
        if (
          existingLocal &&
          loaded.public_key &&
          samePublicKey(publicBundle(existingLocal), loaded.public_key)
        ) {
          const sealed = await getOrCreateIdentity(userId, loaded.public_key, userEmail);
          if (!active) return;
          setVaultLocked(false);
          setIdentity(sealed);
          setProfile(loaded);
          return;
        }

        // 2. Try unlocking the encrypted cloud key vault if password was just entered.
        if (loaded.key_vault && stagedPassword) {
          const restored = await restoreIdentityFromVault(
            userId,
            loaded.key_vault,
            stagedPassword,
            loaded.public_key,
          );
          if (!active) return;
          if (restored) {
            setVaultLocked(false);
            setIdentity(restored);
            setProfile(loaded);
            return;
          }
        }

        // 3. Try migrating a pending signup slot or legacy key that matches loaded.public_key.
        const candidate = await getOrCreateIdentity(userId, loaded.public_key, userEmail);
        if (!active) return;
        const bundle = publicBundle(candidate);

        if (loaded.public_key && samePublicKey(loaded.public_key, bundle)) {
          setVaultLocked(false);
          setIdentity(candidate);
          setProfile(loaded);
          return;
        }

        // 4. If profile has a password-protected key_vault (e.g. opened confirmation link in
        // a separate mobile webview), prompt for password instead of overwriting their keys!
        if (loaded.public_key && loaded.key_vault) {
          setProfile(loaded);
          setIdentity(null);
          setVaultLocked(true);
          return;
        }

        // 5. First-ever key setup (or legacy account without a vault): publish device public key.
        if (!samePublicKey(loaded.public_key, bundle)) {
          loaded = await updateProfile(userId, { public_key: bundle });
        }
        if (!active) return;
        setVaultLocked(false);
        setIdentity(candidate);
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

  const unlockKeyVault = useCallback(
    async (password: string): Promise<boolean> => {
      if (!userId || !profile?.key_vault) return false;
      const restored = await restoreIdentityFromVault(
        userId,
        profile.key_vault,
        password,
        profile.public_key,
      );
      if (!restored) return false;
      setIdentity(restored);
      setVaultLocked(false);
      return true;
    },
    [profile, userId],
  );

  const rotateIdentityWithPassword = useCallback(
    async (password: string): Promise<void> => {
      if (!userId) throw new Error('You are signed out.');
      const { identity: nextIdentity, vault } = await createVaultedIdentity(userId, password);
      const updated = await updateProfile(userId, {
        public_key: publicBundle(nextIdentity),
        key_vault: vault,
      });
      setProfile(updated);
      setIdentity(nextIdentity);
      setVaultLocked(false);
    },
    [userId],
  );

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
    stagedPasswords.clear();
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
      vaultLocked,
      profileError,
      hadRecoverySession,
      stageLoginPassword,
      unlockKeyVault,
      rotateIdentityWithPassword,
      refreshProfile,
      signOut,
    }),
    [
      loading,
      session,
      user,
      profile,
      identity,
      vaultLocked,
      profileError,
      hadRecoverySession,
      stageLoginPassword,
      unlockKeyVault,
      rotateIdentityWithPassword,
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
