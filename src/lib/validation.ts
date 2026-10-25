import { z } from 'zod';

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'burnermail.io',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'harakirimail.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailnull.com',
  'mintemail.com',
  'mohmal.com',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempinbox.com',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'help',
  'mail',
  'moderator',
  'null',
  'official',
  'root',
  'security',
  'sotto',
  'support',
  'system',
  'team',
  'undefined',
  'www',
]);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailDomain(value: string): string {
  return normalizeEmail(value).split('@')[1] ?? '';
}

export function isDisposableEmail(value: string): boolean {
  const domain = emailDomain(value);
  if (!domain) return false;
  for (const blocked of DISPOSABLE_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export const emailSchema = z
  .string()
  .trim()
  .min(5, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')
  .transform(normalizeEmail)
  .refine((value) => !isDisposableEmail(value), {
    message: 'Disposable email addresses are not supported. Use a permanent inbox.',
  });

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters.')
  .max(24, 'Username must be 24 characters or fewer.')
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, and underscores only.')
  .refine((value) => !RESERVED_USERNAMES.has(value), 'That username is reserved.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Add a display name.')
  .max(48, 'Display name must be 48 characters or fewer.');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.');

export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Write a message first.')
  .max(4000, 'Messages are limited to 4,000 characters.');

export const groupTitleSchema = z
  .string()
  .trim()
  .min(1, 'Add a group name.')
  .max(64, 'Group name must be 64 characters or fewer.');

export const searchQuerySchema = z.string().trim().max(40, 'Search is limited to 40 characters.');

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again.';
}
