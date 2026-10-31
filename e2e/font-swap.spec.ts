import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The woff2 requests are held until the test lets them go, so the page is measured in the face it
// shows while the fonts load and again once they have. A fast local run never shows the fallback.
async function holdFonts(page: Page) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*.woff2', async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

async function fontsLoaded(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('600 32px fraunces')))
    .toBe(true);
}

const logoWidth = (page: Page) =>
  page
    .locator('header')
    .getByText('ramble', { exact: true })
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);

for (const width of [390, 1440]) {
  test(`the wordmark keeps its width when the fonts load at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const release = await holdFonts(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const fallback = await expect
      .poll(() => logoWidth(page))
      .toBeGreaterThan(50)
      .then(() => logoWidth(page));

    release();
    await fontsLoaded(page);

    expect(Math.abs((await logoWidth(page)) - fallback)).toBeLessThanOrEqual(1);
  });
}

// The home page falls back to a short "Ramble" panel when it cannot read the database, and the
// CI server has no seeded database. The hero check needs the real page, so it runs only where the
// run says the database is seeded (E2E_SEEDED_HOME=1), and there a fallback panel fails it.
const seededHome = process.env.E2E_SEEDED_HOME === '1';

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`the hero heading keeps its lines and the search stays put when the fonts load at ${String(width)}px`, async ({
    page,
  }) => {
    test.skip(!seededHome, 'needs a seeded database: set E2E_SEEDED_HOME=1');
    await page.setViewportSize({ width, height: 900 });
    const release = await holdFonts(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const hero = page.locator('section[aria-labelledby]').first();
    const heading = hero.getByRole('heading', { level: 1 });
    const search = hero.getByRole('search').or(hero.locator('form')).first();
    await expect(heading).toBeVisible();
    await expect(search).toBeVisible();
    expect(await heading.textContent()).not.toBe('Ramble');

    const measure = () =>
      heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = element.getBoundingClientRect();
        const form = element.closest('section')?.querySelector('form');
        return {
          lines: new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size,
          height: box.height,
          top: box.top,
          searchTop: form?.getBoundingClientRect().top ?? Number.NaN,
        };
      });

    await expect.poll(async () => (await measure()).height).toBeGreaterThan(20);
    const fallback = await measure();
    release();
    await fontsLoaded(page);
    const loaded = await measure();

    expect(loaded.lines).toBe(fallback.lines);
    expect(Math.abs(loaded.height - fallback.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.top - fallback.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.searchTop - fallback.searchTop)).toBeLessThanOrEqual(
      1,
    );
  });
}
