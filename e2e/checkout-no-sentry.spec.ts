import { expect, sentryLoaderUrl, test } from './fixtures';
import { routes } from './routes';

// ADR 0007: no Sentry browser script on checkout. The unit tests hold the source; this holds the
// built output, so a browser SDK bundled in from anywhere is caught too. The server is built with
// a fake SENTRY_BROWSER_DSN (playwright.config.ts), which is what makes the control below mean
// something: the loader is on, and only the guest pages get it.
const checkoutPaths = routes
  .filter(({ group }) => group === 'checkout')
  .map(({ path }) => path);

test('positive control: a guest page loads the Sentry loader', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  const response = await page.goto('/', { waitUntil: 'networkidle' });

  expect(response?.status()).toBe(200);
  expect(await response?.text()).toContain('js.sentry-cdn.com');
  expect(requested.filter((url) => sentryLoaderUrl.test(url))).toEqual([
    'https://js.sentry-cdn.com/0123456789abcdef0123456789abcdef.min.js',
  ]);
});

for (const path of checkoutPaths) {
  test(`${path} loads no Sentry script`, async ({ page }) => {
    const scripts: { url: string; body: string }[] = [];
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    page.on('response', async (response) => {
      if (response.request().resourceType() === 'script') {
        scripts.push({ url: response.url(), body: await response.text() });
      }
    });

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    const html = (await response?.text()) ?? '';

    expect(response?.status()).toBe(200);
    expect(scripts.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/sentry/i);
    expect(requested.filter((url) => /sentry/i.test(url))).toEqual([]);
    expect(
      scripts.filter(({ body }) => /sentry/i.test(body)).map(({ url }) => url),
    ).toEqual([]);
  });
}
