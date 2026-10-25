import { Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
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
          <ShieldCheck size={15} aria-hidden="true" /> Confirm your email and check that the
          database migration has been applied.
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

function HomePage() {
  const { loading, user, profile, identity, profileError } = useAuth();

  if (loading) return <BootSplash />;
  if (!user) return <AuthPage />;
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
