import { describe, expect, it } from 'vitest';
import {
  displayNameSchema,
  emailSchema,
  isDisposableEmail,
  messageTextSchema,
  passwordSchema,
  usernameSchema,
} from '../../src/lib/validation';

describe('validation', () => {
  it('accepts permanent email addresses and normalizes case', () => {
    expect(emailSchema.parse('  Ada@Example.com ')).toBe('ada@example.com');
  });

  it('blocks disposable domains and their subdomains', () => {
    expect(isDisposableEmail('person@mailinator.com')).toBe(true);
    expect(isDisposableEmail('person@inbox.mailinator.com')).toBe(true);
    expect(isDisposableEmail('person@notmailinator.com')).toBe(false);
    expect(emailSchema.safeParse('person@yopmail.com').success).toBe(false);
  });

  it('rejects malformed emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('a@b').success).toBe(false);
  });

  it('enforces username shape, length, and reserved names', () => {
    expect(usernameSchema.parse('  Ada_99 ')).toBe('ada_99');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('has space').success).toBe(false);
    expect(usernameSchema.safeParse('UPPER').success).toBe(true);
    expect(usernameSchema.safeParse('admin').success).toBe(false);
    expect(usernameSchema.safeParse('sotto').success).toBe(false);
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
