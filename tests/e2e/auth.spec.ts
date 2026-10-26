import { expect, test } from '@playwright/test';
import { blockExternalRequests } from './helpers';

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await page.emulateMedia({ colorScheme: 'light' });
});

test('renders an email-only sign-in screen with no phone fields', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveAttribute('type', 'email');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.locator('.auth-story')).toContainText(
    'Messages disappear one minute after reading',
  );
  await expect(page.locator('.auth-mobile-intro')).toContainText('Auto-delete after 1 minute');
  await expect(page.locator('input[type="tel"]')).toHaveCount(0);
});

test('sign-up shows profile photo control, required identity fields, and password rules', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sign up' }).click();

  await expect(page.getByRole('heading', { name: 'Create your Khidki profile' })).toBeVisible();
  await expect(page.getByText('Profile photo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveAttribute('placeholder', 'aum');
  await expect(page.getByLabel(/Username/)).toHaveAttribute('placeholder', 'aum01');
  await expect(page.getByLabel('Confirm password')).toBeVisible();
  await expect(page.getByText(/Email verification is required/i)).toBeVisible();
  await expect(page.getByText(/No phone number needed\./i)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Password requirements' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.locator('input[type="tel"]')).toHaveCount(0);
});

test('validates the sign-in email before contacting the server', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill('not-an-email');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');
});

test('rejects disposable email domains during sign-up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByLabel('Display name').fill('aum');
  await page.getByLabel(/Username/).fill('aum01');
  await page.getByLabel('Email address').fill('person@mailinator.com');
  await page.getByLabel('Password', { exact: true }).fill('longenough1');
  await page.getByLabel('Confirm password').fill('longenough1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Temporary or unverified email domains are blocked. Use Gmail, Outlook, iCloud, Yahoo, Proton, or Zoho.',
  );
});

test('blocks reserved usernames during sign-up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sign up' }).click();

  await page.getByLabel('Display name').fill('aum');
  await page.getByLabel(/Username/).fill('khidki');
  await page.getByLabel('Email address').fill('aum@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('longenough1');
  await page.getByLabel('Confirm password').fill('longenough1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('alert')).toHaveText('That username is reserved.');
});

test('enforces password strength and confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Sign up' }).click();

  await page.getByLabel('Display name').fill('aum');
  await page.getByLabel(/Username/).fill('aum01');
  await page.getByLabel('Email address').fill('aum@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Use at least 10 characters.');

  await page.getByLabel('Password', { exact: true }).fill('longenough1');
  await page.getByLabel('Confirm password').fill('longenough2');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
});

test('toggles password visibility without losing the value', async ({ page }) => {
  await page.goto('/');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('longenough1');

  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('longenough1');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('forgot-password mode asks only for an email address', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Forgot password?' }).click();

  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();
});

test('persists the theme across reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('shows an invalid reset link when there is no recovery session', async ({ page }) => {
  await page.goto('/reset-password');

  await expect(
    page.getByRole('heading', { name: 'This reset link is invalid or expired' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Return to sign in/i })).toBeVisible();
});

test('redirects unknown routes to the sign-in screen', async ({ page }) => {
  await page.goto('/not-a-real-route');

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();
});

test('loads without page errors or unhandled console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByRole('tab', { name: 'Sign in' }).click();

  expect(problems).toEqual([]);
});
