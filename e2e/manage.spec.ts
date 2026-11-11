import { expect, test } from './fixtures';
import { notFoundHeading } from './routes';

// The pages read no database in this suite, so only what happens before a read is checked here: a
// link whose token cannot be one shows the one not-found page, noindex, with nothing to unfurl.
// What a token opens is in tests/db/manage-booking.db.test.ts.

test('a manage link with a malformed token shows the not-found page, noindex, with nothing to unfurl', async ({
  page,
}) => {
  const response = await page.goto('/manage/sample');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: notFoundHeading }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  const headers = response?.headers() ?? {};
  expect(headers['x-robots-tag']).toMatch(/noindex/);
  expect(headers['cache-control']).toBe('no-store');
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(
    page.locator('meta[property^="og:"], meta[name^="twitter:"]'),
  ).toHaveCount(0);
});
