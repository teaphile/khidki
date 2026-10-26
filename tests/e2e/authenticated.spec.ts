import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, setStoredTheme, VIEWPORTS } from './helpers';

/**
 * Authenticated layout coverage against a real Supabase test project.
 *
 * Enable it with all four variables:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD
 *
 * Use a dedicated, throwaway account. Sotto binds an account to the device key
 * in the current browser profile, so this test intentionally provisions a new
 * identity for whichever account it signs in to.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const projectUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const enabled = Boolean(email && password && projectUrl && anonKey);

test.describe('authenticated workspace layout', () => {
  test.skip(
    !enabled,
    'Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_EMAIL, and E2E_PASSWORD to run.',
  );

  test('signs in and stays responsive at every breakpoint', async ({ page }) => {
    test.setTimeout(180_000);
    await setStoredTheme(page, 'light');

    await page.goto('/');
    await page.getByLabel('Email address').fill(email ?? '');
    await page.getByLabel('Password', { exact: true }).fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.locator('.workspace')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('main', { name: 'Conversation' })).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.getByRole('main', { name: 'Conversation' })).toBeVisible();

      const label = viewport.label;
      if (viewport.width < 880) {
        await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeHidden();
      } else {
        await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
      }

      await expectNoHorizontalOverflow(page, `${label} chats`, [
        '.rail *',
        '.list-pane *',
        '.chat-pane *',
        '.mobile-nav *',
      ]);

      // People discovery is the widest list-pane state (search field + actions).
      if (viewport.width < 880) {
        await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .getByRole('button', { name: 'People' })
          .click();
      } else {
        await page.getByRole('button', { name: 'Discover people' }).click();
      }
      await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, `${label} people`, [
        '.rail *',
        '.list-pane *',
        '.chat-pane *',
        '.mobile-nav *',
      ]);

      if (viewport.width < 880) {
        await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .getByRole('button', { name: 'Chats' })
          .click();
      } else {
        await page.getByRole('button', { name: 'Chats', exact: true }).click();
      }
    }

    // Desktop theme switching must not reflow the workspace into overflow.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoHorizontalOverflow(page, '1440x900 workspace dark', [
      '.rail *',
      '.list-pane *',
      '.chat-pane *',
    ]);
  });
});
