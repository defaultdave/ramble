import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

// Windows high contrast drops box-shadow, which is how the components draw their focus rings.
// The home page's error state has a Button and, in the footer, plain links; no rows are needed.
test.use({ forcedColors: 'active' });

const outline = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });

test.describe('focus rings in forced-colors mode', () => {
  test('a focused Button shows an outline', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Try again' });
    await page.keyboard.press('Tab');
    await button.focus();
    await expect(button).toBeFocused();

    const { style, width } = await outline(button);
    expect(style).not.toBe('none');
    expect(width).toBeGreaterThan(0);
  });

  test('a focused link shows an outline', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('contentinfo').getByRole('link').first();
    await page.keyboard.press('Tab');
    await link.focus();
    await expect(link).toBeFocused();

    const { style, width } = await outline(link);
    expect(style).not.toBe('none');
    expect(width).toBeGreaterThan(0);
  });
});
