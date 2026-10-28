import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The e2e server has no database behind it (playwright.config.ts gives it a URL that nothing
// answers). So these specs cover what does not need rows: the frame every guest page shares, the
// error state of the home page and its retry, and that nothing scrolls sideways. The modules
// themselves are covered by the component tests, the stories, and tests/db/home.db.test.ts.

// The framework's route announcer is also an alert, so the error is found by its words.
const errorAlert = (page: Page) =>
  page.getByRole('alert').filter({ hasText: "We couldn't load the home page" });

test.describe('the home page when its read fails', () => {
  test('keeps the heading, the header, and the footer, and says what happened', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ramble', exact: true }),
    ).toBeVisible();
    await expect(errorAlert(page)).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('retries from the same address', async ({ page }) => {
    await page.goto('/');
    await errorAlert(page).getByRole('button', { name: 'Try again' }).click();

    await expect(page).toHaveURL(/\/\?$|\/$/);
    await expect(errorAlert(page)).toBeVisible();
  });
});

test.describe('the frame of a guest page', () => {
  test('lets a keyboard user skip to the page', async ({ page }) => {
    await page.goto('/help');
    const skip = page.getByRole('link', { name: 'Skip to main content' });

    await skip.focus();
    await expect(skip).toBeInViewport();
    await skip.press('Enter');

    await expect(page).toHaveURL(/#main$/);
  });

  test('opens the menu on a phone and lists the main links', async ({
    page,
  }) => {
    await page.goto('/help');
    const toggle = page.locator('summary', { hasText: 'Menu' });
    const menu = page.getByRole('navigation', { name: 'Main menu' });

    await expect(menu.getByRole('link', { name: 'Gift guide' })).toBeHidden();
    await toggle.click();

    await expect(
      menu.getByRole('link', { name: 'Things to do' }),
    ).toHaveAttribute('href', '/new-york/browse');
    await expect(menu.getByRole('link', { name: 'Gift guide' })).toBeVisible();
  });

  test('links the footer to the pages that exist', async ({ page }) => {
    await page.goto('/help');
    const footer = page.getByRole('navigation', { name: 'Footer' });

    for (const name of ['Help center', 'Contact us', 'Terms', 'Privacy']) {
      await expect(footer.getByRole('link', { name })).toBeVisible();
    }
  });
});

test.describe('sideways scroll', () => {
  for (const path of ['/', '/help']) {
    test(`${path} does not scroll sideways at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );

      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
