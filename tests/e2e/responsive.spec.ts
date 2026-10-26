import { expect, test } from '@playwright/test';
import {
  blockExternalRequests,
  expectFullyVisible,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  setStoredTheme,
  VIEWPORTS,
} from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`public and auth screens hold their layout in ${theme} theme`, async ({ page }) => {
    await blockExternalRequests(page);
    await setStoredTheme(page, theme);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      const label = `${viewport.label} (${theme})`;
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();

      await expectNoHorizontalOverflow(page, `${label} sign in`);
      await expectFullyVisible(page, '.auth-card', `${label} sign in`);
      await expectFullyVisible(page, '.auth-form button[type="submit"]', `${label} sign in`);
      await expectNoOverlap(page, '.brand', '.auth-topbar__actions', `${label} header`);
      await expectNoOverlap(page, '.auth-card__heading', '.auth-tabs', `${label} sign in`);

      await page.getByRole('tab', { name: 'Sign up' }).click();
      await expect(page.getByRole('heading', { name: 'Create your Khidki profile' })).toBeVisible();

      await expectNoHorizontalOverflow(page, `${label} sign up`);
      await expectFullyVisible(page, '.auth-card', `${label} sign up`);
      await expectFullyVisible(page, '.auth-form button[type="submit"]', `${label} sign up`);
      await expectNoOverlap(page, '.auth-card__heading', '.auth-tabs', `${label} sign up`);

      await page.getByRole('tab', { name: 'Sign in' }).click();
      await page.getByRole('button', { name: 'Forgot password?' }).click();
      await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();

      await expectNoHorizontalOverflow(page, `${label} forgot password`);
      await expectFullyVisible(page, '.auth-card', `${label} forgot password`);
      await expectFullyVisible(
        page,
        '.auth-form button[type="submit"]',
        `${label} forgot password`,
      );

      await page.goto('/reset-password');
      await expect(
        page.getByRole('heading', { name: 'This reset link is invalid or expired.' }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, `${label} reset password`);
      await expectFullyVisible(page, '.auth-card', `${label} reset password`);
    }
  });
}

test('theme switching does not disturb the layout', async ({ page }) => {
  await blockExternalRequests(page);

  for (const viewport of [
    { width: 320, height: 480 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to Khidki' })).toBeVisible();

    const label = `${viewport.width}x${viewport.height}`;
    await expectNoHorizontalOverflow(page, `${label} light`);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoHorizontalOverflow(page, `${label} dark`);
    await expectFullyVisible(page, '.auth-card', `${label} dark`);

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoHorizontalOverflow(page, `${label} light again`);
  }
});
