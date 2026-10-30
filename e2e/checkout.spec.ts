import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { checkoutPaths, deviceCookieValue, notFoundHeading } from './routes';

// The e2e server has no database behind it (playwright.config.ts gives it a URL that nothing
// answers), so a hold cannot be read and the pay flow cannot run here. These specs cover what needs
// no rows: an address that is no hold, a guest with no device, and the error state of a hold read
// that fails. The form, the states, and the pay flow against the fake gateway are covered by the
// component tests and the stories; the PM's run of the pay flow needs a seeded database.

const notFound = (page: Page) =>
  page.getByRole('heading', { level: 1, name: notFoundHeading });

test.describe('an address that is no hold', () => {
  test('a malformed id is a not-found, with no database read', async ({
    page,
  }) => {
    const response = await page.goto(checkoutPaths.malformed);

    expect(response?.status()).toBe(200);
    await expect(notFound(page)).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('a well-formed id from a browser with no device is a not-found and sets no cookie', async ({
    page,
  }) => {
    const response = await page.goto(checkoutPaths.wellFormed);

    expect(response?.status()).toBe(200);
    await expect(notFound(page)).toBeVisible();
    expect(await response?.headerValue('set-cookie')).toBeNull();
  });
});

test.describe('a hold that cannot be read', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      {
        name: 'ramble_device',
        value: deviceCookieValue,
        url: baseURL ?? 'http://localhost:3100',
      },
    ]);
  });

  test('keeps the page and says what happened, and retries from the same address', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(checkoutPaths.wellFormed);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Checkout' }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: "We couldn't load checkout" }),
    ).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    await page.getByRole('link', { name: 'Try again' }).click();
    await expect(page).toHaveURL(new RegExp(`${checkoutPaths.wellFormed}$`));
    expect(errors).toEqual([]);
  });

  test('does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(checkoutPaths.wellFormed);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
