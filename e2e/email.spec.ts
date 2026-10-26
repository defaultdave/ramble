import { expect, test } from '@playwright/test';
import { notFoundHeading } from './routes';
import { e2eMailboxSecret, e2eWebhookSecret } from './secrets';

// The e2e server has a mailbox secret and a webhook secret but no real database, so these cover
// the refusals and the unlock form, which never reach the database.

const webhook = '/api/webhooks/email';

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

test('a wrong mailbox secret is refused with an alert and sets no cookie', async ({
  page,
  context,
}) => {
  await page.goto('/ops/mailbox');

  await page.getByLabel('Dev mailbox secret').fill(`${e2eMailboxSecret}-wrong`);
  await page.getByRole('button', { name: 'Open mailbox' }).click();

  await expect(page.getByText('That secret did not match.')).toBeVisible();
  await expect(page.getByLabel('Dev mailbox secret')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page).toHaveURL(/\/ops\/mailbox\?denied=1$/);
  expect(await context.cookies()).toEqual([]);
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

test.describe('the email webhook', () => {
  test('refuses a request with no credentials', async ({ request }) => {
    const response = await request.post(webhook, { data: '{}' });

    expect(response.status()).toBe(401);
  });

  test('refuses the wrong secret', async ({ request }) => {
    const response = await request.post(webhook, {
      data: '{}',
      headers: { authorization: `Bearer ${e2eWebhookSecret}-wrong` },
    });

    expect(response.status()).toBe(401);
  });

  test('lets the right secret through to body validation', async ({
    request,
  }) => {
    const response = await request.post(webhook, {
      data: 'not json',
      headers: { authorization: `Bearer ${e2eWebhookSecret}` },
    });

    expect(response.status()).toBe(400);
  });
});
