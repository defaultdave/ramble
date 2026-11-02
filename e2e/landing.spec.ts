import { expect, test } from './fixtures';
import { landingPaths, notFoundHeading } from './routes';

// The e2e server has no database behind it (playwright.config.ts gives it a URL that nothing
// answers). So these specs cover what does not need rows: an address that is not a slug, and the
// error state of a well-formed one. The copy, the results, and the not-found of a slug the catalog
// lacks are covered by the unit tests and the stories.

for (const { name, notASlug, wellFormed } of landingPaths) {
  test.describe(`the ${name} page`, () => {
    test('an address that is not a slug is not found', async ({ page }) => {
      const response = await page.goto(notASlug);

      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: notFoundHeading }),
      ).toBeVisible();
    });

    test('keeps a heading and says what happened when the read fails', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      const response = await page.goto(wellFormed);

      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: 'Things to do in New York',
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: "We couldn't load this page" }),
      ).toBeVisible();
      await expect(page).toHaveTitle('Things to do in New York | Ramble');
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('Try again comes back to the same address', async ({ page }) => {
      await page.goto(wellFormed);

      await page.getByRole('button', { name: 'Try again' }).click();

      await expect(page).toHaveURL(wellFormed);
    });
  });
}
