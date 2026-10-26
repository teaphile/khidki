import { z } from 'zod';

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'burnermail.io',
  'crazymailing.com',
  'discard.email',
  'dispostable.com',
  'emailfake.com',
  'emailondeck.com',
  'example.com',
  'example.net',
  'example.org',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxkitten.com',
  'invalid.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailnull.com',
  'mailpoof.com',
  'mailsac.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spambox.us',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmailo.com',
  'test.com',
  'test.org',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
]);

// Established real inbox providers + academic domains to block random throwaway domains.
const TRUSTED_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.in',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'yahoo.in',
  'yahoo.co.in',
  'yahoo.co.uk',
  'ymail.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'zohomail.com',
  'zohomail.in',
  'aol.com',
  'fastmail.com',
  'tuta.com',
  'tutamail.com',
  'tutanota.com',
  'gmx.com',
  'gmx.de',
  'mail.com',
  'rediffmail.com',
  'hey.com',
]);

const RESERVED_USERNAMES = new Set([
  'admin',
  'api',
  'help',
  'mail',
  'mod',
  'null',
  'official',
  'root',
  'security',
  'sotto',
  'support',
  'system',
  'team',
  'www',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  for (const blocked of DISPOSABLE_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

export function isTrustedEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  if (isDisposableEmail(email)) return false;
  if (TRUSTED_EMAIL_DOMAINS.has(domain)) return true;
  if (domain.endsWith('.edu') || domain.endsWith('.ac.in') || domain.endsWith('.edu.in')) {
    return true;
  }
  return false;
}

export function sanitizeUsernameInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Enter a valid email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.')
  .refine((email) => !email.split('@')[0]?.includes('+'), {
    message: 'Email aliases with a + sign are not allowed.',
  })
  .refine((email) => !isDisposableEmail(email), {
    message: 'Temporary or disposable email addresses are not allowed.',
  })
  .refine((email) => isTrustedEmailDomain(email), {
    message:
      'Use a verified personal or academic email provider such as Gmail, Outlook, iCloud, Yahoo, Proton, or Zoho.',
  });

export const signInEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Enter a valid email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Usernames must be at least 3 characters.')
  .max(10, 'Usernames can be at most 10 characters.')
  .regex(/^[a-z0-9]+$/, 'Use only English letters (a-z) and numbers (0-9).')
  .refine((name) => !RESERVED_USERNAMES.has(name), 'That username is reserved.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(36, 'Display names can be at most 36 characters.');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use 128 characters or fewer.')
  .refine((value) => /[a-z]/i.test(value), 'Include at least one letter.')
  .refine((value) => /\d/.test(value), 'Include at least one number.');

export const groupTitleSchema = z
  .string()
  .trim()
  .min(1, 'Give the group a name.')
  .max(48, 'Group names can be at most 48 characters.');

export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Write a message first.')
  .max(4000, 'Messages are limited to 4,000 characters.');

export type PasswordRuleState = {
  length: boolean;
  letter: boolean;
  number: boolean;
};

export function checkPasswordRules(password: string): PasswordRuleState {
  return {
    length: password.length >= 10 && password.length <= 128,
    letter: /[a-z]/i.test(password),
    number: /\d/.test(password),
  };
}

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the highlighted fields and try again.';
}
