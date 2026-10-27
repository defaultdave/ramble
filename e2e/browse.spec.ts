import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The e2e server has no database behind it (playwright.config.ts gives it a URL that nothing
// answers). So these specs cover what does not need rows: the address grammar, the robots rule, the
// states the page shows when the read fails, and that the retry and the address round-trip. What
// they cannot reach is the rendered results grid, the chips, Show more, and the calendar days; those
// are covered by the component tests, the stories, and the database tests in tests/db/browse.db.test.ts.

const browse = '/new-york/browse';
const cursor = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8';

// The framework's route announcer is also an alert, so the error is found by its words.
const errorAlert = (page: Page) =>
  page
    .getByRole('alert')
    .filter({ hasText: "We couldn't load the experiences" });

const robots = (page: Page) => page.locator('meta[name="robots"]');

test.describe('robots', () => {
  test('the unfiltered first page is for search engines', async ({ page }) => {
    await page.goto(browse);
    await expect(robots(page)).toHaveCount(0);
  });

  test('an attribution parameter alone does not make it noindex', async ({
    page,
  }) => {
    await page.goto(`${browse}?utm_source=newsletter&utm_medium=email`);
    await expect(robots(page)).toHaveCount(0);
  });

  for (const [name, query] of [
    ['a category', 'category=cooking'],
    ['a neighborhood', 'neighborhood=dumbo'],
    ['a date', 'date=2026-11-07'],
    [
      'two categories and a date',
      'category=cooking&category=wine&date=2026-11-07',
    ],
    ['a later page', `after=${cursor}`],
  ] as const) {
    test(`${name} is noindex`, async ({ page }) => {
      await page.goto(`${browse}?${query}`);
      await expect(robots(page)).toHaveAttribute('content', /noindex/);
    });
  }

  for (const [name, query] of [
    ['an unknown parameter', 'sort=price'],
    ['a malformed slug', 'category=NOT%20A%20SLUG'],
    ['a date that is not a day', 'date=2026-02-30'],
    ['a cursor that is not an id', 'after=abc'],
  ] as const) {
    test(`${name} is dropped, so the page stays indexable`, async ({
      page,
    }) => {
      const response = await page.goto(`${browse}?${query}`);
      expect(response?.status()).toBe(200);
      await expect(robots(page)).toHaveCount(0);
    });
  }

  test('a list over the bound is dropped whole', async ({ page }) => {
    const nine = Array.from({ length: 9 }, (_, i) => `category=c${String(i)}`);
    await page.goto(`${browse}?${nine.join('&')}`);
    await expect(robots(page)).toHaveCount(0);
  });
});

test.describe('when the read fails', () => {
  test('the page keeps its heading and says what happened', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto(browse);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Browse experiences' }),
    ).toBeVisible();
    await expect(errorAlert(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Try again goes to the same address, with the filters', async ({
    page,
  }) => {
    await page.goto(
      `${browse}?category=cooking&neighborhood=dumbo&date=2026-11-07`,
    );

    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page).toHaveURL(
      `${browse}?category=cooking&neighborhood=dumbo&date=2026-11-07`,
    );
    await expect(errorAlert(page)).toBeVisible();
  });

  test('Try again drops what the grammar does not know and keeps the cursor', async ({
    page,
  }) => {
    await page.goto(`${browse}?utm_source=x&category=cooking&after=${cursor}`);

    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page).toHaveURL(`${browse}?category=cooking&after=${cursor}`);
  });

  test('the error leaves nothing to scroll sideways at a phone width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(browse);
    await expect(errorAlert(page)).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
