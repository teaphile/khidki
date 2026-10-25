import { expect, type Page } from '@playwright/test';

export type Viewport = { width: number; height: number; label: string };

/**
 * Small phones through ultrawide monitors, including short landscape windows
 * where vertical space is the constraint rather than width.
 */
export const VIEWPORTS: Viewport[] = [
  { width: 320, height: 480, label: '320x480 small phone' },
  { width: 360, height: 640, label: '360x640 phone' },
  { width: 375, height: 667, label: '375x667 phone' },
  { width: 390, height: 844, label: '390x844 tall phone' },
  { width: 414, height: 896, label: '414x896 large phone' },
  { width: 600, height: 800, label: '600x800 small tablet' },
  { width: 768, height: 1024, label: '768x1024 tablet' },
  { width: 820, height: 1180, label: '820x1180 tablet' },
  { width: 1024, height: 600, label: '1024x600 short laptop' },
  { width: 1024, height: 768, label: '1024x768 laptop' },
  { width: 1280, height: 800, label: '1280x800 laptop' },
  { width: 1440, height: 900, label: '1440x900 desktop' },
  { width: 1920, height: 1080, label: '1920x1080 desktop' },
  { width: 2560, height: 1440, label: '2560x1440 ultrawide' },
];

/** Keep tests hermetic: never contact Supabase or any third-party host. */
export async function blockExternalRequests(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    return route.abort();
  });
}

export async function setStoredTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('sotto.theme', value);
    } catch {
      // Storage can be unavailable; the default theme still renders.
    }
  }, theme);
}

type OverflowReport = {
  viewportWidth: number;
  documentWidth: number;
  shellWidth: number;
  shellClientWidth: number;
  offenders: string[];
};

async function measureOverflow(page: Page, selectors: string[]): Promise<OverflowReport> {
  return page.evaluate((scopeSelectors) => {
    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : '';
      const classes = element.classList.length ? `.${[...element.classList].join('.')}` : '';
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };

    const root = document.documentElement;
    const shell = document.querySelector<HTMLElement>(
      '.auth-shell, .workspace, .setup-shell, .fatal-shell',
    );
    const seen = new Set<Element>();
    const offenders: string[] = [];

    for (const selector of scopeSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        // Decorative, non-interactive art is intentionally allowed to bleed.
        if (element.getAttribute('aria-hidden') === 'true' && element.children.length === 0) {
          continue;
        }
        if (rect.left < -1 || rect.right > root.clientWidth + 1) {
          offenders.push(
            `${describe(element)} [${Math.round(rect.left)}..${Math.round(rect.right)}]`,
          );
        }
      }
    }

    return {
      viewportWidth: root.clientWidth,
      documentWidth: root.scrollWidth,
      shellWidth: shell?.scrollWidth ?? 0,
      shellClientWidth: shell?.clientWidth ?? 0,
      offenders: offenders.slice(0, 12),
    };
  }, selectors);
}

/**
 * Asserts the page never scrolls sideways and that interactive/text content
 * stays inside the viewport. Pass a context label so failures identify the
 * exact screen, width, and theme.
 */
export async function expectNoHorizontalOverflow(
  page: Page,
  context: string,
  selectors: string[] = ['.auth-card *', '.auth-topbar *', '.auth-footer *', '.auth-story *'],
): Promise<void> {
  // Let fonts settle so measurements use final glyph widths.
  await page.evaluate(() => document.fonts.ready);

  const report = await measureOverflow(page, selectors);

  expect(
    report.documentWidth,
    `${context}: document scrolls horizontally (${report.documentWidth}px > ${report.viewportWidth}px)`,
  ).toBeLessThanOrEqual(report.viewportWidth + 1);

  if (report.shellClientWidth > 0) {
    expect(
      report.shellWidth,
      `${context}: shell content is clipped horizontally (${report.shellWidth}px > ${report.shellClientWidth}px)`,
    ).toBeLessThanOrEqual(report.shellClientWidth + 1);
  }

  expect(report.offenders, `${context}: content extends outside the viewport`).toEqual([]);
}

/** Asserts a visible element is fully inside the viewport. */
export async function expectFullyVisible(
  page: Page,
  selector: string,
  context: string,
): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${context}: ${selector} is not rendered`).not.toBeNull();
  if (!box) return;

  const viewport = page.viewportSize();
  expect(viewport, `${context}: viewport is not set`).not.toBeNull();
  if (!viewport) return;

  expect(box.x, `${context}: ${selector} starts outside the viewport`).toBeGreaterThanOrEqual(-1);
  expect(
    box.x + box.width,
    `${context}: ${selector} overflows the viewport (${box.x + box.width}px > ${viewport.width}px)`,
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y, `${context}: ${selector} starts above the viewport`).toBeGreaterThanOrEqual(-1);
}

/** Asserts two visible elements do not overlap each other. */
export async function expectNoOverlap(
  page: Page,
  first: string,
  second: string,
  context: string,
): Promise<void> {
  const a = await page.locator(first).first().boundingBox();
  const b = await page.locator(second).first().boundingBox();
  if (!a || !b) return;

  const overlaps =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, `${context}: ${first} overlaps ${second}`).toBe(false);
}
