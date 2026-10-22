import { expect, test } from '@playwright/test';

test('home page renders the placeholder', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Ramble');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ramble' }),
  ).toBeVisible();
});
