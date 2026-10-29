import { expect, test } from './fixtures';

// The e2e server has no database behind it, so home and the experience page show their error states
// and the Book link cannot be reached here; it is covered by the ExperiencePage component test. This
// spec starts at the address that link builds and clicks through the rest.
// TODO(U-047b): replaced when the real checkout and confirmation pages land.

const demoCheckout =
  '/checkout/00000000-0000-4000-8000-0000000000d1?experience=00000000-0000-4000-8000-000000000001';

test('a guest goes from the checkout stub, through Pay (demo), to the confirmation stub and back to browse', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const response = await page.goto(demoCheckout);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Checkout' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('No payment is taken');
  await expect(
    page.getByText('$85 × 2 guests').locator('visible=true'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Pay (demo)' }).click();

  await expect(page).toHaveURL(/\/orders\/RMB-DEMO01$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Order confirmation' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'demo order is confirmed',
  );
  await expect(
    page.getByText('$85 × 2 guests').locator('visible=true'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Browse more experiences' }).click();

  await expect(page).toHaveURL(/\/new-york\/browse$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browse experiences' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
