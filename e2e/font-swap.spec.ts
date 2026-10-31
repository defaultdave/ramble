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

async function measure(page: Page) {
  const logo = page.locator('header').getByText('ramble', { exact: true });
  const heading = page.getByRole('heading', { level: 1 });
  const [logoBox, headingBox] = await Promise.all([
    logo.first().boundingBox(),
    heading.boundingBox(),
  ]);
  if (!logoBox || !headingBox) throw new Error('logo or h1 not rendered');
  return { logo: logoBox, heading: headingBox };
}

for (const width of [390, 1440]) {
  test(`the logo and h1 keep their boxes when the fonts load at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const release = await holdFonts(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // The streamed page parks the heading in a 1 px box until its swap script has run.
    await expect
      .poll(
        async () =>
          (await page.getByRole('heading', { level: 1 }).boundingBox())
            ?.width ?? 0,
      )
      .toBeGreaterThan(100);
    const fallback = await measure(page);

    release();
    await page.evaluate(() => document.fonts.ready);
    // The load is only proven by the fonts being in use, not by the clock.
    await expect
      .poll(() =>
        page.evaluate(() => document.fonts.check('600 32px fraunces')),
      )
      .toBe(true);
    const loaded = await measure(page);

    expect(
      Math.abs(loaded.logo.width - fallback.logo.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(loaded.logo.height - fallback.logo.height),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(loaded.heading.width - fallback.heading.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(loaded.heading.height - fallback.heading.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.heading.y - fallback.heading.y)).toBeLessThanOrEqual(
      1,
    );
  });
}
