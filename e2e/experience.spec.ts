import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { experiencePaths, notFoundHeading } from './routes';

// The e2e server has no database behind it (playwright.config.ts gives it a URL that nothing
// answers), so these specs cover what needs no rows: the not-found for an address that is not an
// experience's, the error state of a well-formed address and its retry, and that neither scrolls
// sideways. The page itself is covered by the component tests, the stories, and the route test.

const errorAlert = (page: Page) =>
  page
    .getByRole('alert')
    .filter({ hasText: "We couldn't load this experience" });

test.describe('an address that is not an experience', () => {
  test('is a not-found with the guest frame around it', async ({ page }) => {
    const response = await page.goto(experiencePaths.notFound);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: notFoundHeading }),
    ).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });
});

test.describe('the experience page when its read fails', () => {
  test('keeps a heading and the frame, and says what happened', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto(experiencePaths.readFails);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Experience', exact: true }),
    ).toBeVisible();
    await expect(errorAlert(page)).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('retries from the same address', async ({ page }) => {
    await page.goto(experiencePaths.readFails);
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page).toHaveURL(
      new RegExp(`${experiencePaths.readFails}\\??$`),
    );
    await expect(errorAlert(page)).toBeVisible();
  });
});

test.describe('sideways scroll', () => {
  for (const path of Object.values(experiencePaths)) {
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
