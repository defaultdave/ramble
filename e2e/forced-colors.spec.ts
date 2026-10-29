import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Windows high contrast drops box-shadow, which is how the components draw their focus rings.
// Every component also sets a transparent outline, which forced colors already paints in a system
// colour, so "has an outline" passes without src/styles/forced-colors.css. Only that file gives the
// ring a 2 px CanvasText outline offset by 2 px, so the specs assert the offset and the colour.
// The home page's error state has a Button and, in the footer, plain links; no rows are needed.
test.use({ forcedColors: 'active' });

const outline = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.color = 'CanvasText';
    document.body.append(probe);
    const canvasText = getComputedStyle(probe).color;
    probe.remove();
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      offset: parseFloat(style.outlineOffset),
      color: style.outlineColor,
      canvasText,
    };
  });

async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 40; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error('Tab never reached the element');
}

async function expectRing(locator: Locator) {
  const ring = await outline(locator);
  expect(ring.style).toBe('solid');
  expect(ring.width).toBe(2);
  expect(ring.offset).toBe(2);
  expect(ring.color).toBe(ring.canvasText);
}

test.describe('focus rings in forced-colors mode', () => {
  test('a Tab-focused Button shows a 2px CanvasText outline offset by 2px', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Try again' });
    await tabTo(page, button);
    await expect(button).toBeFocused();
    await expectRing(button);
  });

  test('a Tab-focused link shows a 2px CanvasText outline offset by 2px', async ({
    page,
  }) => {
    await page.goto('/');
    const link = page.getByRole('contentinfo').getByRole('link').first();
    await tabTo(page, link);
    await expect(link).toBeFocused();
    await expectRing(link);
  });
});
