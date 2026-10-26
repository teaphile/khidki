import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEnterToSendPreference, writeEnterToSendPreference } from '../../src/lib/preferences';

const STORAGE_KEY = 'khidki.chat.enter-to-send';

describe('chat preferences', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the existing desktop behavior when no preference is saved', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    expect(readEnterToSendPreference()).toBe(true);
  });

  it('keeps Enter-to-send off by default on coarse-pointer devices', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(readEnterToSendPreference()).toBe(false);
  });

  it('persists the chosen setting locally and reads it on the next app load', () => {
    writeEnterToSendPreference(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(readEnterToSendPreference()).toBe(false);

    writeEnterToSendPreference(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(readEnterToSendPreference()).toBe(true);
  });
});
