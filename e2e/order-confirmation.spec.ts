import { expect, test } from './fixtures';
import { notFoundHeading } from './routes';

// The pages read no database in this suite, so only what happens before a read is checked here: the
// token handoff, the headers, the head of the page, and the not-found page a link with no token gets.
// What the token opens is in tests/db/orderConfirmation.db.test.ts.

const reference = 'RMB-A3K7MN';
const token = 'A'.repeat(43);

test('a confirmation link moves its token into a cookie and redirects without it', async ({
  request,
}) => {
  const response = await request.get(`/orders/${reference}?t=${token}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe(`/orders/${reference}`);
  const cookie = response.headers()['set-cookie'] ?? '';
  expect(cookie).toContain(`ramble_order_access=${token}`);
  expect(cookie).toContain(`Path=/orders/${reference}`);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('a guest who lands on the link ends on the address without the token', async ({
  page,
}) => {
  await page.route(`**/orders/${reference}`, (route) =>
    route.fulfill({ status: 200, body: '<title>stub</title>' }),
  );
  await page.goto(`/orders/${reference}?t=${token}`);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).pathname).toBe(`/orders/${reference}`);
});

test('a link with no token shows the one not-found page (a streamed 200, like the other not-found pages here), noindex, with nothing to unfurl', async ({
  page,
}) => {
  const response = await page.goto(`/orders/${reference}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: notFoundHeading }),
  ).toBeVisible();
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
