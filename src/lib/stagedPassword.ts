const STAGED_PASSWORD_TTL_MS = 20_000;

type StagedPassword = {
  password: string;
  expiresAt: number;
  timeoutId: number;
};

const stagedPasswords = new Map<string, StagedPassword>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Keep the password only long enough for the auth state listener to restore
 * the encrypted key vault. A failed or abandoned login drops it automatically.
 */
export function stageLoginPassword(email: string, password: string): void {
  const key = normalizeEmail(email);
  const previous = stagedPasswords.get(key);
  if (previous) {
    window.clearTimeout(previous.timeoutId);
    previous.password = '';
  }

  const expiresAt = Date.now() + STAGED_PASSWORD_TTL_MS;
  const timeoutId = window.setTimeout(() => {
    const current = stagedPasswords.get(key);
    if (current?.expiresAt === expiresAt) {
      current.password = '';
      stagedPasswords.delete(key);
    }
  }, STAGED_PASSWORD_TTL_MS);

  stagedPasswords.set(key, { password, expiresAt, timeoutId });
}

/** Consume and immediately discard a password, even when it has expired. */
export function consumeStagedPassword(email: string | null): string | null {
  if (!email) return null;
  const key = normalizeEmail(email);
  const entry = stagedPasswords.get(key);
  if (!entry) return null;

  window.clearTimeout(entry.timeoutId);
  stagedPasswords.delete(key);
  const password = entry.password;
  entry.password = '';
  return entry.expiresAt <= Date.now() ? null : password;
}

/** Discard a failed or abandoned login handoff immediately. */
export function discardStagedPassword(email: string): void {
  const key = normalizeEmail(email);
  const entry = stagedPasswords.get(key);
  if (!entry) return;

  window.clearTimeout(entry.timeoutId);
  entry.password = '';
  stagedPasswords.delete(key);
}

/** Clear all staged passwords and their expiry timers on sign-out. */
export function clearStagedPasswords(): void {
  for (const entry of stagedPasswords.values()) {
    window.clearTimeout(entry.timeoutId);
    entry.password = '';
  }
  stagedPasswords.clear();
}
