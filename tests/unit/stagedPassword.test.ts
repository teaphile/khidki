import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStagedPasswords,
  consumeStagedPassword,
  discardStagedPassword,
  stageLoginPassword,
} from '../../src/lib/stagedPassword';

describe('temporary login-password handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'));
    clearStagedPasswords();
  });

  afterEach(() => {
    clearStagedPasswords();
    vi.useRealTimers();
  });

  it('normalizes email addresses and discards a password immediately when consumed', () => {
    stageLoginPassword(' AUM@example.com ', 'short-lived-password');

    expect(consumeStagedPassword('aum@example.com')).toBe('short-lived-password');
    expect(consumeStagedPassword('aum@example.com')).toBeNull();
  });

  it('immediately discards a failed login handoff', () => {
    stageLoginPassword('aum@example.com', 'invalid-password');

    discardStagedPassword('aum@example.com');

    expect(consumeStagedPassword('aum@example.com')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('automatically drops a password after twenty seconds if login is abandoned', () => {
    stageLoginPassword('aum@example.com', 'short-lived-password');

    vi.advanceTimersByTime(20_001);

    expect(consumeStagedPassword('aum@example.com')).toBeNull();
  });

  it('keeps a replacement password when an earlier handoff timer fires', () => {
    stageLoginPassword('aum@example.com', 'first-password');
    vi.advanceTimersByTime(15_000);
    stageLoginPassword('aum@example.com', 'replacement-password');
    vi.advanceTimersByTime(6_000);

    expect(consumeStagedPassword('aum@example.com')).toBe('replacement-password');
  });

  it('clears all passwords and expiry timers on sign-out', () => {
    stageLoginPassword('aum@example.com', 'short-lived-password');
    clearStagedPasswords();

    expect(consumeStagedPassword('aum@example.com')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
