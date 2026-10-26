import { expect, test } from '@playwright/test';
import {
  expectedTitle,
  notFoundHeading,
  routes,
  unknownPaths,
  unknownPathStatus,
  unprerenderedParamPath,
  type RouteGroup,
} from './routes';

for (const { path, heading, noindex } of routes) {
  test(`${path} renders its placeholder`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page).toHaveTitle(expectedTitle(heading));

    const robots = page.locator('meta[name="robots"]');
    if (noindex) {
      await expect(robots).toHaveAttribute('content', /noindex/);
    } else {
      await expect(robots).toHaveCount(0);
    }

    expect(consoleErrors).toEqual([]);
  });
}

for (const [group, path] of Object.entries(unknownPaths) as [
  RouteGroup,
  string,
][]) {
  test(`an unknown ${group} path lands on the not-found page`, async ({
    page,
  }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(unknownPathStatus(group));
    await expect(
      page.getByRole('heading', { level: 1, name: notFoundHeading }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });
}

test('a cached route renders for a parameter that was not prerendered', async ({
  page,
}) => {
  const response = await page.goto(unprerenderedParamPath);

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ramble Picks' }),
  ).toBeVisible();
});
