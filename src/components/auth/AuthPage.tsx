import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  AtSign,
  Check,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { isUsernameAvailable } from '../../lib/data';
import { supabase } from '../../lib/env';
import { publicBundle } from '../../lib/crypto';
import { getOrCreateIdentity } from '../../lib/identityStore';
import {
  displayNameSchema,
  emailSchema,
  firstIssue,
  passwordSchema,
  usernameSchema,
} from '../../lib/validation';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';

type Mode = 'signin' | 'signup' | 'forgot' | 'check-email' | 'forgot-sent';

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Confirm your email before signing in.';
  }
  if (/user already registered|already been registered/i.test(message)) {
    return 'An account with that email already exists. Sign in instead.';
  }
  if (/disposable|not supported/i.test(message)) {
    return 'Disposable email addresses are not supported. Use a permanent inbox.';
  }
  if (/rate limit|after \d+ seconds|too many/i.test(message)) {
    return 'Too many attempts. Wait a moment before trying again.';
  }
  if (/password should|password is too/i.test(message)) {
    return 'Choose a stronger password with at least 10 characters, a letter, and a number.';
  }
  if (/database error|trigger|duplicate key/i.test(message)) {
    return 'That username or email is already in use.';
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return message || 'Something went wrong. Please try again.';
}

export function AuthPage() {
  const { resolved } = useTheme();
  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const startupError = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const description = hash.get('error_description') ?? query.get('error_description');
    return description ? description.replace(/\+/g, ' ') : null;
  }, []);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(startupError);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!startupError) return;
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [startupError]);

  const passwordRules = useMemo(
    () => [
      { label: '10+ characters', valid: password.length >= 10 },
      { label: 'One letter', valid: /[A-Za-z]/.test(password) },
      { label: 'One number', valid: /[0-9]/.test(password) },
    ],
    [password],
  );

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setNotice(null);
    setNeedsConfirmation(false);
    setPassword('');
    setConfirmPassword('');
  };

  const handleSignIn = async () => {
    if (!supabase) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) throw new Error(firstIssue(parsed.error));
    if (!password) throw new Error('Enter your password.');

    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data,
      password,
    });
    if (error) {
      if (/email not confirmed/i.test(error.message)) setNeedsConfirmation(true);
      throw error;
    }
  };

  const handleSignUp = async () => {
    if (!supabase) return;
    const parsedName = displayNameSchema.safeParse(displayName);
    if (!parsedName.success) throw new Error(firstIssue(parsedName.error));
    const parsedUsername = usernameSchema.safeParse(username);
    if (!parsedUsername.success) throw new Error(firstIssue(parsedUsername.error));
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) throw new Error(firstIssue(parsedEmail.error));
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) throw new Error(firstIssue(parsedPassword.error));
    if (password !== confirmPassword) throw new Error('Passwords do not match.');

    if (!(await isUsernameAvailable(parsedUsername.data))) {
      throw new Error('That username is already taken.');
    }

    const identity = await getOrCreateIdentity();
    const bundle = publicBundle(identity);

    const { data, error } = await supabase.auth.signUp({
      email: parsedEmail.data,
      password: parsedPassword.data,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          username: parsedUsername.data,
          display_name: parsedName.data,
          public_key: bundle,
        },
      },
    });
    if (error) throw error;

    if (data.session && data.user?.email_confirmed_at) {
      setNotice('Account created. You are signed in.');
      return;
    }

    setNotice(null);
    setMode('check-email');
  };

  const handleForgot = async () => {
    if (!supabase) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) throw new Error(firstIssue(parsed.error));
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error && !/rate limit/i.test(error.message)) throw error;
    setMode('forgot-sent');
  };

  const resendConfirmation = async () => {
    if (!supabase) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setFormError(firstIssue(parsed.error));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: parsed.data,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      setNotice('A fresh confirmation email is on its way.');
    } catch (error) {
      setFormError(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      if (mode === 'signin') await handleSignIn();
      if (mode === 'signup') await handleSignUp();
      if (mode === 'forgot') await handleForgot();
    } catch (error) {
      setFormError(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <a className="brand brand--link" href="/" aria-label="Sotto home">
          <LogoMark />
          <span>Sotto</span>
        </a>
        <div className="auth-topbar__actions">
          <span className="privacy-pill">
            <ShieldCheck size={15} aria-hidden="true" />
            Private by design
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="auth-stage">
        <section className="auth-story" aria-label="About Sotto">
          <div className="auth-story__content">
            <span className="eyebrow">Private conversations. Nothing kept.</span>
            <h1>
              Speak freely.
              <br />
              Leave no archive.
            </h1>
            <p>
              Sotto is built for conversations that belong to the moment. Messages and files are
              encrypted in your browser and disappear two minutes after they are sent.
            </p>
            <ul className="auth-points">
              <li>
                <Clock3 size={19} aria-hidden="true" />
                <div>
                  <strong>Ephemeral by default</strong>
                  <span>No message history. Return tomorrow to a clean slate.</span>
                </div>
              </li>
              <li>
                <ShieldCheck size={19} aria-hidden="true" />
                <div>
                  <strong>Encrypted in your browser</strong>
                  <span>Your keys stay on your device, never on the server.</span>
                </div>
              </li>
              <li>
                <AtSign size={19} aria-hidden="true" />
                <div>
                  <strong>Email-verified people</strong>
                  <span>Find people by username. Every account has a real inbox.</span>
                </div>
              </li>
            </ul>
          </div>
          <div className="auth-story__stamp" aria-hidden="true">
            <span>2:00</span>
            <small>then gone</small>
          </div>
        </section>

        <section className="auth-panel" aria-label="Account access">
          <div className="auth-card">
            {mode === 'check-email' ? (
              <div className="auth-success">
                <span className="auth-success__icon">
                  <Mail size={24} aria-hidden="true" />
                </span>
                <span className="eyebrow">One more step</span>
                <h2>Check your inbox.</h2>
                <p>
                  We sent a confirmation link to <strong>{email}</strong>. Open it to verify your
                  account, then return here to sign in.
                </p>
                {notice ? <p className="inline-notice">{notice}</p> : null}
                {formError ? (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="button button--primary button--wide"
                  onClick={resendConfirmation}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
                  Resend confirmation email
                </button>
                <button
                  type="button"
                  className="button button--ghost button--wide"
                  onClick={() => switchMode('signin')}
                >
                  Back to sign in
                </button>
              </div>
            ) : mode === 'forgot-sent' ? (
              <div className="auth-success">
                <span className="auth-success__icon">
                  <Mail size={24} aria-hidden="true" />
                </span>
                <span className="eyebrow">Reset requested</span>
                <h2>Check your email.</h2>
                <p>
                  If an account exists for <strong>{email}</strong>, a secure reset link is on its
                  way. The link expires shortly for your protection.
                </p>
                <button
                  type="button"
                  className="button button--primary button--wide"
                  onClick={() => switchMode('signin')}
                >
                  Return to sign in
                </button>
              </div>
            ) : (
              <>
                <div className="auth-card__heading">
                  <span className="eyebrow">
                    {mode === 'signin'
                      ? 'Welcome back'
                      : mode === 'signup'
                        ? 'Create an account'
                        : 'Reset access'}
                  </span>
                  <h2>
                    {mode === 'signin'
                      ? 'Sign in to Sotto'
                      : mode === 'signup'
                        ? 'Start a private conversation'
                        : 'Forgot your password?'}
                  </h2>
                  <p>
                    {mode === 'signin'
                      ? 'Use the email and password you registered with.'
                      : mode === 'signup'
                        ? 'A verified email address is required. No phone numbers.'
                        : 'We will email you a secure link to choose a new password.'}
                  </p>
                </div>

                {mode !== 'forgot' ? (
                  <div className="segmented auth-tabs" role="tablist" aria-label="Account access">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signin'}
                      className={mode === 'signin' ? 'is-active' : ''}
                      onClick={() => switchMode('signin')}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signup'}
                      className={mode === 'signup' ? 'is-active' : ''}
                      onClick={() => switchMode('signup')}
                    >
                      Sign up
                    </button>
                  </div>
                ) : null}

                <form className="auth-form" onSubmit={onSubmit} noValidate>
                  {mode === 'signup' ? (
                    <div className="form-grid form-grid--two">
                      <label className="field">
                        <span>Display name</span>
                        <input
                          value={displayName}
                          onChange={(event) => setDisplayName(event.target.value)}
                          autoComplete="name"
                          maxLength={48}
                          placeholder="Ada Lovelace"
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Username</span>
                        <span className="input-prefix">
                          <AtSign size={16} aria-hidden="true" />
                          <input
                            value={username}
                            onChange={(event) =>
                              setUsername(
                                event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                              )
                            }
                            autoComplete="username"
                            maxLength={24}
                            placeholder="ada"
                            spellCheck={false}
                            required
                          />
                        </span>
                      </label>
                    </div>
                  ) : null}

                  <label className="field">
                    <span>Email address</span>
                    <span className="input-prefix">
                      <Mail size={16} aria-hidden="true" />
                      <input
                        type="email"
                        inputMode="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        maxLength={254}
                        placeholder="you@example.com"
                        required
                      />
                    </span>
                  </label>

                  {mode !== 'forgot' ? (
                    <label className="field">
                      <span>Password</span>
                      <span className="input-prefix">
                        <KeyRound size={16} aria-hidden="true" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          maxLength={128}
                          placeholder={
                            mode === 'signup' ? 'At least 10 characters' : 'Your password'
                          }
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
                  ) : null}

                  {mode === 'signup' ? (
                    <>
                      <label className="field">
                        <span>Confirm password</span>
                        <span className="input-prefix">
                          <KeyRound size={16} aria-hidden="true" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            maxLength={128}
                            placeholder="Repeat your password"
                            required
                          />
                        </span>
                      </label>
                      <ul className="password-rules" aria-label="Password requirements">
                        {passwordRules.map((rule) => (
                          <li key={rule.label} data-valid={rule.valid}>
                            <Check size={13} aria-hidden="true" />
                            {rule.label}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {mode === 'signin' ? (
                    <div className="form-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => switchMode('forgot')}
                      >
                        Forgot password?
                      </button>
                    </div>
                  ) : null}

                  {formError ? (
                    <div className="form-error" role="alert">
                      <span>{formError}</span>
                      {needsConfirmation ? (
                        <button type="button" className="text-button" onClick={resendConfirmation}>
                          Resend confirmation email
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {notice ? <p className="inline-notice">{notice}</p> : null}

                  <button
                    type="submit"
                    className="button button--primary button--wide button--tall"
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
                    {mode === 'signin'
                      ? 'Sign in'
                      : mode === 'signup'
                        ? 'Create account'
                        : 'Send reset link'}
                    {!busy ? <ArrowRight size={18} aria-hidden="true" /> : null}
                  </button>

                  {mode === 'forgot' ? (
                    <button
                      type="button"
                      className="button button--ghost button--wide"
                      onClick={() => switchMode('signin')}
                    >
                      Back to sign in
                    </button>
                  ) : null}
                </form>

                <p className="auth-card__footnote">
                  {mode === 'signup'
                    ? 'By continuing, you confirm this is your own email address. Sotto never asks for a phone number.'
                    : 'Sotto is a private messenger. Messages are never saved to a message archive.'}
                </p>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="auth-footer">
        <span>Sotto · Private conversations. Nothing kept.</span>
        <span className={`theme-note theme-note--${resolved}`}>
          <Clock3 size={14} aria-hidden="true" /> Messages expire after 2 minutes
        </span>
      </footer>
    </div>
  );
}
