import { expect, test } from '@playwright/test';
import { notFoundHeading } from './routes';

// The e2e server has a mailbox secret but no real database, so these cover only what renders
// without one. Unlocking and the webhook count a rate-limit try first, which needs the database;
// their refusals are covered by unit tests and tests/db/email.db.test.ts.

test('the dev mailbox shows only the unlock form to a visitor with no cookie', async ({
  page,
}) => {
  const response = await page.goto('/ops/mailbox');

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dev mailbox' }),
  ).toBeVisible();
  await expect(page.getByLabel('Dev mailbox secret')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Captured email' })).toHaveCount(
    0,
  );
});

test('a mailbox message page looks missing without the cookie', async ({
  page,
}) => {
  await page.goto('/ops/mailbox/5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10');

  await expect(
    page.getByRole('heading', { level: 1, name: notFoundHeading }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Dev mailbox message' }),
  ).toHaveCount(0);
});
