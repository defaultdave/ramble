import { expect, test } from '@playwright/test';
import { routes } from './routes';

// ADR 0007: no Sentry browser script on checkout. The unit tests hold the source; this holds the
// built output, so a browser SDK bundled in from anywhere is caught too.
const checkoutPaths = routes
  .filter(({ group }) => group === 'checkout')
  .map(({ path }) => path);

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
