import { useEffect, useMemo, useRef, useState } from 'react';
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
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { isUsernameAvailable } from '../../lib/data';
import { supabase } from '../../lib/env';
import { publicBundle } from '../../lib/crypto';
import { commitSignupIdentity, stageSignupIdentityWithVault } from '../../lib/identityStore';
import {
  displayNameSchema,
  emailSchema,
  firstIssue,
  passwordSchema,
  sanitizeUsernameInput,
  signInEmailSchema,
  usernameSchema,
} from '../../lib/validation';
import { DpUploadControl } from '../ui/DpUploadControl';
import { LogoMark } from '../ui/LogoMark';
import { ThemeToggle } from '../ui/ThemeToggle';

type Mode = 'signin' | 'signup' | 'forgot' | 'check-email' | 'forgot-sent';

function safeStartupAuthError(search: string, hash: string): string | null {
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(search);
  const code = (hashParams.get('error_code') ?? queryParams.get('error_code') ?? '').toLowerCase();
  const error = (hashParams.get('error') ?? queryParams.get('error') ?? '').toLowerCase();
  const rawDescription = (
    hashParams.get('error_description') ??
    queryParams.get('error_description') ??
    ''
  ).toLowerCase();

  if (!code && !error && !rawDescription) return null;

  if (code.includes('otp_expired') || rawDescription.includes('expired')) {
    return 'That verification or reset link has expired. Sign in if already verified, or request a fresh link.';
  }
  if (code.includes('flow_state')) {
    return 'Email link opened in another browser. If you confirmed your email, sign in directly below.';
  }
  if (rawDescription.includes('invalid')) {
    return 'That email link was already used or is no longer active. Sign in directly or request a fresh link.';
  }
  if (error === 'access_denied') {
    return 'Email verification could not be completed. Request a fresh link if needed.';
  }
  return 'Authentication could not be completed. Please sign in below.';
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Verify your email inbox first, then sign in.';
  }
  if (/user already registered|already been registered|canonical_email/i.test(message)) {
    return 'An account with that email already exists. Sign in instead.';
  }
  if (/disposable|temporary|trusted|not supported|not allowed/i.test(message)) {
    return 'Temporary or unverified email domains are blocked. Use Gmail, Outlook, iCloud, Yahoo, Proton, or Zoho.';
  }
  if (/error sending confirmation email|not authorized/i.test(message)) {
    return 'Verification email could not be delivered right now. Connect custom SMTP in Supabase Auth settings for public email delivery.';
  }
  if (/rate limit|after \d+ seconds|too many/i.test(message)) {
    return 'Too many email requests in a short window. Wait a minute and try again.';
  }
  if (/password should|password is too/i.test(message)) {
    return 'Choose a stronger password with at least 10 characters, a letter, and a number.';
  }
  if (/username|duplicate key/i.test(message)) {
    return 'That username or email is already taken.';
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return message || 'Something went wrong. Please try again.';
}

export function AuthPage() {
  const { stageLoginPassword } = useAuth();
  const { resolved } = useTheme();
  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [dpUrl, setDpUrl] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | 'available' | 'taken'>(
    'idle',
  );
  const checkSeq = useRef(0);

  const startupError = useMemo(
    () => safeStartupAuthError(window.location.search, window.location.hash),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(startupError);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (startupError || window.location.hash.includes('error')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [startupError]);

  useEffect(() => {
    if (mode !== 'signup') {
      setUsernameState('idle');
      return;
    }
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setUsernameState('idle');
      return;
    }
    const seq = ++checkSeq.current;
    setUsernameState('checking');
    const timer = window.setTimeout(() => {
      void isUsernameAvailable(parsed.data)
        .then((ok) => {
          if (checkSeq.current === seq) {
            setUsernameState(ok ? 'available' : 'taken');
          }
        })
        .catch(() => {
          if (checkSeq.current === seq) setUsernameState('idle');
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mode, username]);

  const passwordRules = useMemo(
    () => [
      { label: '10 or more characters', valid: password.length >= 10 },
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
    const parsed = signInEmailSchema.safeParse(email);
    if (!parsed.success) throw new Error(firstIssue(parsed.error));
    if (!password) throw new Error('Enter your password.');

    stageLoginPassword(parsed.data, password);

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

    const { identity, vault } = await stageSignupIdentityWithVault(
      parsedEmail.data,
      parsedPassword.data,
    );
    const bundle = publicBundle(identity);

    stageLoginPassword(parsedEmail.data, parsedPassword.data);

    const { data, error } = await supabase.auth.signUp({
      email: parsedEmail.data,
      password: parsedPassword.data,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          username: parsedUsername.data,
          display_name: parsedName.data,
          avatar_url: dpUrl,
          public_key: bundle,
          key_vault: vault,
        },
      },
    });
    if (error) throw error;

    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('An account with that email already exists. Sign in instead.');
    }

    if (data.user?.id) {
      await commitSignupIdentity(data.user.id, parsedEmail.data, identity);
    }

    if (data.session && data.user?.email_confirmed_at) {
      setNotice('Account created. You are signed in.');
      return;
    }

    setNotice(null);
    setMode('check-email');
  };

  const handleForgot = async () => {
    if (!supabase) return;
    const parsed = signInEmailSchema.safeParse(email);
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
      setNotice('A fresh verification link has been sent to your inbox.');
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
        <a className="brand brand--link" href="/" aria-label="Khidki home">
          <LogoMark />
          <span>Khidki</span>
        </a>
        <div className="auth-topbar__actions">
          <span className="privacy-pill">
            <ShieldCheck size={15} aria-hidden="true" />
            End-to-end encrypted
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="auth-mobile-intro" aria-label="Highlights">
        <span className="auth-chip">
          <ShieldCheck size={13} aria-hidden="true" /> Verified inbox only
        </span>
        <span className="auth-chip">
          <Clock3 size={13} aria-hidden="true" /> Clears 1m after seen
        </span>
        <span className="auth-chip">
          <Lock size={13} aria-hidden="true" /> No message edits
        </span>
      </div>

      <main className="auth-stage">
        <section className="auth-story" aria-label="About Khidki">
          <div className="auth-story__content">
            <span className="eyebrow">Private messenger</span>
            <h1>
              Open your window.
              <br />
              Nothing lingers behind.
            </h1>
            <p>
              Messages stay sealed while you are offline and only start their one minute timer when
              you open that person’s chat. Once read, texts, photos, videos, and files clear
              automatically.
            </p>
            <ul className="auth-points">
              <li>
                <Clock3 size={19} aria-hidden="true" />
                <div>
                  <strong>Clears one minute after seen</strong>
                  <span>Unread chats wait safely until you open each conversation yourself.</span>
                </div>
              </li>
              <li>
                <ShieldCheck size={19} aria-hidden="true" />
                <div>
                  <strong>Sealed in your browser</strong>
                  <span>Texts, media, files, and calls stay encrypted end to end.</span>
                </div>
              </li>
              <li>
                <AtSign size={19} aria-hidden="true" />
                <div>
                  <strong>Verified accounts only</strong>
                  <span>Disposable mail is blocked and new contacts arrive as requests.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="auth-panel" aria-label="Account access">
          <div className="auth-card">
            {mode === 'check-email' ? (
              <div className="auth-success">
                <span className="auth-success__icon">
                  <Mail size={24} aria-hidden="true" />
                </span>
                <span className="eyebrow">Verify your email</span>
                <h2>Check your inbox</h2>
                <p>
                  We sent a verification link to <strong>{email}</strong>. Open the link to activate{' '}
                  <strong>@{username}</strong>, then sign in here.
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
                  Resend verification email
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
                <h2>Check your email</h2>
                <p>
                  If an account exists for <strong>{email}</strong>, a password reset link is on its
                  way.
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
                        ? 'Create account'
                        : 'Reset access'}
                  </span>
                  <h2>
                    {mode === 'signin'
                      ? 'Sign in to Khidki'
                      : mode === 'signup'
                        ? 'Create your Khidki profile'
                        : 'Forgot your password?'}
                  </h2>
                  <p>
                    {mode === 'signin'
                      ? 'Sign in with your verified email and password.'
                      : mode === 'signup'
                        ? 'Use a real personal inbox. Temporary mail is blocked.'
                        : 'We will email you a link to set a new password.'}
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
                    <>
                      <DpUploadControl
                        name={displayName || 'aum'}
                        seed={username || 'aum01'}
                        value={dpUrl}
                        onChange={setDpUrl}
                        disabled={busy}
                      />

                      <div className="form-grid form-grid--two">
                        <label className="field">
                          <span>Display name</span>
                          <input
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            autoComplete="name"
                            maxLength={36}
                            placeholder="aum"
                            required
                          />
                        </label>
                        <label className="field">
                          <span className="field__label-row">
                            <span>Username</span>
                            <small className="field__counter">{username.length}/10</small>
                          </span>
                          <span className="input-prefix">
                            <AtSign size={16} aria-hidden="true" />
                            <input
                              value={username}
                              onChange={(event) =>
                                setUsername(sanitizeUsernameInput(event.target.value))
                              }
                              autoComplete="username"
                              minLength={3}
                              maxLength={10}
                              placeholder="aum01"
                              spellCheck={false}
                              autoCapitalize="none"
                              required
                            />
                          </span>
                          <small className={`field__hint field__hint--${usernameState}`}>
                            {usernameState === 'available'
                              ? 'Username available'
                              : usernameState === 'taken'
                                ? 'Already taken'
                                : '3 to 10 chars, a to z and 0 to 9'}
                          </small>
                        </label>
                      </div>
                    </>
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
                        placeholder="aum@gmail.com"
                        autoCapitalize="none"
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
                          Resend verification email
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
                    ? 'Email verification is required before first sign in. No phone number needed.'
                    : 'Chats stay closed when you sign in so timers only start when you open a conversation.'}
                </p>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="auth-footer">
        <span>Khidki · Private messenger</span>
        <span className={`theme-note theme-note--${resolved}`}>
          <Lock size={14} aria-hidden="true" /> Encrypted end to end · Clears 1m after seen
        </span>
      </footer>
    </div>
  );
}
