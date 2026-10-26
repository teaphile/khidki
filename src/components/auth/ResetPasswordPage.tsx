import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/env';
import { firstIssue, passwordSchema } from '../../lib/validation';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';

export function ResetPasswordPage() {
  const { session, rotateIdentityWithPassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !session) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) throw new Error(firstIssue(parsed.error));
      if (password !== confirmPassword) throw new Error('Passwords do not match.');
      const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data });
      if (updateError) throw updateError;
      await rotateIdentityWithPassword(parsed.data).catch(() => undefined);
      setDone(true);
      await signOut();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell auth-shell--centered">
      <header className="auth-topbar">
        <a className="brand brand--link" href="/" aria-label="Sotto home">
          <LogoMark />
          <span>Sotto</span>
        </a>
        <ThemeToggle />
      </header>

      <main className="auth-panel auth-panel--solo">
        <div className="auth-card">
          {done ? (
            <div className="auth-success">
              <span className="auth-success__icon">
                <CheckCircle2 size={24} aria-hidden="true" />
              </span>
              <span className="eyebrow">Password updated</span>
              <h2>Your account is secure</h2>
              <p>
                Your password and encryption key vault have been refreshed. Sign in with your new
                password to continue.
              </p>
              <button
                type="button"
                className="button button--primary button--wide"
                onClick={() => navigate('/')}
              >
                Go to sign in <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          ) : !session ? (
            <div className="auth-success">
              <span className="auth-success__icon auth-success__icon--warning">
                <ShieldAlert size={24} aria-hidden="true" />
              </span>
              <span className="eyebrow">Link unavailable</span>
              <h2>This reset link is invalid or expired</h2>
              <p>Request a new password reset link from the sign-in screen.</p>
              <button
                type="button"
                className="button button--primary button--wide"
                onClick={() => navigate('/')}
              >
                Return to sign in <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <div className="auth-card__heading">
                <span className="eyebrow">Account recovery</span>
                <h2>Choose a new password</h2>
                <p>Use at least 10 characters with a letter and a number.</p>
              </div>
              <form className="auth-form" onSubmit={onSubmit} noValidate>
                <label className="field">
                  <span>New password</span>
                  <span className="input-prefix">
                    <KeyRound size={16} aria-hidden="true" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      maxLength={128}
                      required
                    />
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff size={17} aria-hidden="true" />
                      ) : (
                        <Eye size={17} aria-hidden="true" />
                      )}
                    </button>
                  </span>
                </label>
                <label className="field">
                  <span>Confirm new password</span>
                  <span className="input-prefix">
                    <KeyRound size={16} aria-hidden="true" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      maxLength={128}
                      required
                    />
                  </span>
                </label>
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="button button--primary button--wide button--tall"
                  disabled={busy}
                >
                  {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
                  Update password
                  {!busy ? <ArrowRight size={18} aria-hidden="true" /> : null}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
