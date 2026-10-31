import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The woff2 requests are held until the test lets them go, so the page is measured in the face it
// shows while the fonts load and again once they have. A fast local run never shows the fallback.
async function holdFonts(page: Page) {
  let release = () => {};
  let held = 0;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*.woff2', async (route) => {
    held += 1;
    await released;
    await route.continue();
  });
  return { release, held: () => held };
}

// next/font names the family in --font-face-fraunces, so the test reads it instead of guessing.
const displayFamily = (page: Page) =>
  page.evaluate(() => {
    const stack = getComputedStyle(document.documentElement).getPropertyValue(
      '--font-face-fraunces',
    );
    return stack.split(',')[0]?.trim().replace(/["']/g, '') ?? '';
  });

const loadedFaces = (page: Page, family: string) =>
  page.evaluate((name) => {
    const faces = [...document.fonts].filter(
      (face) => face.family.replace(/["']/g, '') === name,
    );
    return {
      total: faces.length,
      loaded: faces.filter((face) => face.status === 'loaded').length,
    };
  }, family);

// Proves the page is showing the fallback: a font request is parked in the route and no face of
// the display family has loaded. It fails if the route glob stops matching.
async function expectFallbackShown(
  page: Page,
  held: () => number,
  family: string,
) {
  await expect.poll(held).toBeGreaterThan(0);
  const faces = await loadedFaces(page, family);
  expect(faces.total).toBeGreaterThan(0);
  expect(faces.loaded).toBe(0);
  await expectTunedFallbackResolved(page);
}

// The tuned fallbacks are local() faces, so which one applies depends on the fonts on the machine.
// If none resolves, the page is showing an untuned system serif and the width check below would
// measure that, so this fails and names every face with its status.
async function expectTunedFallbackResolved(page: Page) {
  const statuses = () =>
    page.evaluate(() =>
      [...document.fonts]
        .filter((face) =>
          face.family.replace(/["']/g, '').startsWith('Fraunces Fallback'),
        )
        .map((face) => `${face.family.replace(/["']/g, '')}: ${face.status}`),
    );
  await expect
    .poll(async () => (await statuses()).join(', '), {
      message: 'no tuned fallback face matched an installed font',
    })
    .toMatch(/: loaded/);
}

async function expectFontLoaded(page: Page, family: string) {
  await expect
    .poll(async () => (await loadedFaces(page, family)).loaded)
    .toBeGreaterThan(0);
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
    const { release, held } = await holdFonts(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => logoWidth(page)).toBeGreaterThan(50);
    const family = await displayFamily(page);
    expect(family).not.toBe('');
    await expectFallbackShown(page, held, family);
    const fallback = await logoWidth(page);

    release();
    await expectFontLoaded(page, family);

    expect(Math.abs((await logoWidth(page)) - fallback)).toBeLessThanOrEqual(1);
  });
}

// The hero check is manual until a seeded e2e job exists: the CI server has no seeded database,
// so the home page shows a short "Ramble" panel instead of the hero. Run it with E2E_SEEDED_HOME=1
// against a seeded build (docs/runbooks/seed.md); there the missing hero fails it.
const seededHome = process.env.E2E_SEEDED_HOME === '1';

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`the hero heading keeps its lines and the search stays put when the fonts load at ${String(width)}px`, async ({
    page,
  }) => {
    test.skip(!seededHome, 'needs a seeded database: set E2E_SEEDED_HOME=1');
    await page.setViewportSize({ width, height: 900 });
    const { release, held } = await holdFonts(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const search = page.getByRole('form', { name: 'Find something to do' });
    const hero = page.getByRole('region').filter({ has: search });
    const heading = hero.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(search).toBeVisible();
    expect(await heading.textContent()).not.toBe('Ramble');

    const measure = async () => {
      const lines = await heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top)),
        ).size;
      });
      const box = await heading.boundingBox();
      const searchBox = await search.boundingBox();
      if (!box || !searchBox) throw new Error('hero not laid out');
      return {
        lines,
        height: box.height,
        top: box.y,
        searchTop: searchBox.y,
      };
    };

    await expect.poll(async () => (await measure()).height).toBeGreaterThan(20);
    const family = await displayFamily(page);
    await expectFallbackShown(page, held, family);
    const fallback = await measure();

    release();
    await expectFontLoaded(page, family);
    const loaded = await measure();

    expect(loaded.lines).toBe(fallback.lines);
    expect(Math.abs(loaded.height - fallback.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.top - fallback.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.searchTop - fallback.searchTop)).toBeLessThanOrEqual(
      1,
    );
  });
}
