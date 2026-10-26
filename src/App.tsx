import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { ChatProvider } from './context/ChatContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { AuthPage } from './components/auth/AuthPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { BootSplash } from './components/BootSplash';
import { CallOverlay } from './components/calls/CallOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupNotice } from './components/SetupNotice';
import { Avatar } from './components/ui/Avatar';
import { LogoMark } from './components/ui/LogoMark';
import { Workspace } from './components/workspace/Workspace';

function AccountProblem() {
  const { profileError, signOut } = useAuth();
  return (
    <div className="fatal-shell">
      <div className="fatal-card">
        <LogoMark size={44} />
        <span className="auth-success__icon auth-success__icon--warning">
          <AlertTriangle size={24} aria-hidden="true" />
        </span>
        <span className="eyebrow">Account setup</span>
        <h1>Your secure profile could not load.</h1>
        <p>{profileError ?? 'The account is signed in, but its profile is unavailable.'}</p>
        <p className="fatal-note">
          <ShieldCheck size={15} aria-hidden="true" /> Confirm your email and sign in again.
        </p>
        <div className="fatal-actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={17} aria-hidden="true" /> Try again
          </button>
          <button type="button" className="button button--ghost" onClick={() => void signOut()}>
            <LogOut size={17} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function VaultUnlockScreen() {
  const { profile, unlockKeyVault, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError('Enter your account password to unlock your encrypted inbox.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockKeyVault(password);
      if (!ok) {
        setError('Incorrect password. Enter the password you used when creating this account.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fatal-shell">
      <div className="fatal-card">
        {profile ? (
          <Avatar
            name={profile.display_name}
            seed={profile.id}
            dpUrl={profile.avatar_url}
            size="lg"
          />
        ) : (
          <LogoMark size={44} />
        )}
        <span className="eyebrow">Encrypted key vault</span>
        <h1>Unlock your messages</h1>
        <p>
          Enter your password once on this browser to restore your private encryption keys and read
          waiting messages.
        </p>
        <form className="auth-form" onSubmit={handleUnlock} style={{ width: '100%' }}>
          <label className="field" style={{ textAlign: 'left' }}>
            <span>Account password</span>
            <span className="input-prefix">
              <KeyRound size={16} aria-hidden="true" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Your password"
                required
              />
            </span>
          </label>
          {error ? (
            <div className="form-error" role="alert">
              <span>{error}</span>
            </div>
          ) : null}
          <button type="submit" className="button button--primary button--wide" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
            Unlock inbox
          </button>
          <button
            type="button"
            className="button button--ghost button--wide"
            onClick={() => void signOut()}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

function HomePage() {
  const { loading, user, profile, identity, vaultLocked, profileError, hadRecoverySession } =
    useAuth();

  if (loading) return <BootSplash />;
  if (hadRecoverySession && user) return <Navigate to="/reset-password" replace />;
  if (!user) return <AuthPage />;
  if (vaultLocked && profile) return <VaultUnlockScreen />;
  if (profileError || !profile || !identity) return <AccountProblem />;

  return (
    <ChatProvider>
      <CallProvider>
        <Workspace />
        <CallOverlay />
      </CallProvider>
    </ChatProvider>
  );
}

function PasswordPage() {
  const { loading, configured } = useAuth();
  if (!configured) return <SetupNotice />;
  if (loading) return <BootSplash />;
  return <ResetPasswordPage />;
}

function AppRoutes() {
  const { configured } = useAuth();
  if (!configured) return <SetupNotice />;

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reset-password" element={<PasswordPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
