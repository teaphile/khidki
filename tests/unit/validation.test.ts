import { describe, expect, it } from 'vitest';
import {
  displayNameSchema,
  emailSchema,
  isDisposableEmail,
  isTrustedEmailDomain,
  messageTextSchema,
  passwordSchema,
  sanitizeUsernameInput,
  usernameSchema,
} from '../../src/lib/validation';

describe('validation', () => {
  it('accepts trusted real email providers and normalizes case', () => {
    expect(emailSchema.parse('  Ashish@Gmail.com ')).toBe('ashish@gmail.com');
    expect(emailSchema.parse('student@iitk.ac.in')).toBe('student@iitk.ac.in');
    expect(emailSchema.parse('user@proton.me')).toBe('user@proton.me');
    expect(isTrustedEmailDomain('person@outlook.com')).toBe(true);
  });

  it('blocks disposable, fake, random, and +alias emails', () => {
    expect(isDisposableEmail('person@mailinator.com')).toBe(true);
    expect(isDisposableEmail('person@inbox.mailinator.com')).toBe(true);
    expect(emailSchema.safeParse('person@yopmail.com').success).toBe(false);
    expect(emailSchema.safeParse('person@example.com').success).toBe(false);
    expect(emailSchema.safeParse('person@randomfake999.xyz').success).toBe(false);
    expect(emailSchema.safeParse('ashish+spam@gmail.com').success).toBe(false);
  });

  it('rejects malformed emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b').success).toBe(false);
  });

  it('enforces strict 3-10 char English letters and digits only for usernames', () => {
    expect(usernameSchema.parse('  Ada99 ')).toBe('ada99');
    expect(usernameSchema.parse('abc')).toBe('abc');
    expect(usernameSchema.parse('abcdefgh12')).toBe('abcdefgh12');
    // Rejects <3 or >10 characters
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('abcdefgh123').success).toBe(false);
    // Rejects underscores, dots, dashes, spaces, and non-English scripts
    expect(usernameSchema.safeParse('ada_99').success).toBe(false);
    expect(usernameSchema.safeParse('ada.99').success).toBe(false);
    expect(usernameSchema.safeParse('ada-99').success).toBe(false);
    expect(usernameSchema.safeParse('has space').success).toBe(false);
    // Rejects reserved handles
    expect(usernameSchema.safeParse('admin').success).toBe(false);
    expect(usernameSchema.safeParse('sotto').success).toBe(false);
    // Input sanitizer strips disallowed chars and caps at 10
    expect(sanitizeUsernameInput('Ashish_Kumar!2026')).toBe('ashishkuma');
  });

  it('requires a strong enough password', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('alllettersonly').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(false);
    expect(passwordSchema.parse('longenough1')).toBe('longenough1');
  });

  it('trims display names and messages', () => {
    expect(displayNameSchema.parse('  Ada Lovelace ')).toBe('Ada Lovelace');
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(messageTextSchema.parse('  hello  ')).toBe('hello');
    expect(messageTextSchema.safeParse('   ').success).toBe(false);
    expect(messageTextSchema.safeParse('x'.repeat(4001)).success).toBe(false);
  });
});
