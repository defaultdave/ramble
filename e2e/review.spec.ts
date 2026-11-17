import { expect, test } from './fixtures';
import { notFoundHeading } from './routes';

// The pages read no database in this suite, so only what happens before a read is checked here: a
// link whose reference or token cannot be one shows the review page's one "link does not work"
// state, noindex, with nothing to unfurl, and an address with no token at all is the not-found page.
// What a link opens, and what a submit writes, is in tests/db/review-invites.db.test.ts.

const reference = 'RMB-7K3M9Q';

test('a review link with a malformed token says the link does not work, noindex, with nothing to unfurl', async ({
  page,
}) => {
  const response = await page.goto(`/review/${reference}/sample`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'How was it?' }),
  ).toBeVisible();
  await expect(page.getByText("This review link doesn't work")).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  // Nothing to write on: no form for a link that opens nothing.
  await expect(page.locator('form')).toHaveCount(0);
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
  // Not `no-referrer`: that makes a browser send `Origin: null` on the form post, which a Server
  // Action refuses, so the form would fail with scripting off. `origin` still keeps the token out.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    'content',
    'origin',
  );
});

test('a review address with no token is the not-found page', async ({
  page,
}) => {
  const response = await page.goto(`/review/${reference}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: notFoundHeading }),
  ).toBeVisible();
});
