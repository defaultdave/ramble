import { reportAxeViolations } from './axe';
import { expect, test } from './fixtures';

// The one path every other spec stops short of: browse, pick a time, hold, pay on the fake gateway,
// and land on a confirmed order. It needs the seeded database `pnpm e2e:db` prepares, so it runs
// only with E2E_DATABASE_URL set; playwright.config.ts starts the second server it uses.
// Locally: `docker compose -p ramble up -d --wait`, then
//   E2E_DATABASE_URL=postgres://ramble:ramble@localhost:5432/ramble pnpm e2e:db
// and run `pnpm e2e` with the same variable.

test.skip(
  !process.env.E2E_DATABASE_URL,
  'E2E_DATABASE_URL is not set: the booking path needs a migrated, seeded Postgres (pnpm e2e:db).',
);

test('a guest browses, holds, pays on the fake gateway, and sees a confirmed order', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);

  await page.goto('/new-york/browse');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Browse experiences' }),
  ).toBeVisible();
  await reportAxeViolations(page, testInfo, 'browse');

  await page.locator('a[href^="/experiences/"]').first().click();
  await expect(page).toHaveURL(/\/experiences\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await reportAxeViolations(page, testInfo, 'experience');

  await page.getByRole('button', { name: 'Choose date' }).click();
  const sheet = page.locator('[data-booking-sheet]');
  await sheet
    .getByRole('button', { name: /^(?!Today)\w+, \w+ \d+, \d{4}$/ })
    .first()
    .click();
  await sheet
    .locator('button[aria-pressed]:not([aria-disabled])')
    .first()
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Continue/ })
    .click();

  await expect(page).toHaveURL(/\/checkout\//);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Checkout' }),
  ).toBeVisible();
  await reportAxeViolations(page, testInfo, 'checkout');

  await page.getByLabel('Email').fill('guest@example.com');
  await page.getByLabel('Lead guest name').fill('Sam Guest');
  const phone = page.getByLabel('Phone');
  if (await phone.count()) await phone.fill('2125550123');
  const waiver = page.getByLabel(
    'I accept the waiver for everyone in my party',
  );
  if (await waiver.count()) await waiver.check();
  await page
    .getByLabel("I accept Ramble's terms and the cancellation terms below")
    .check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Expiry date, month and year').fill('12/34');
  await page.getByLabel('Security code').fill('123');
  await page.getByLabel('ZIP code').fill('10001');
  await reportAxeViolations(page, testInfo, 'payment');
  await page.getByRole('button', { name: /^Pay / }).click();

  await expect(page).toHaveURL(/\/orders\/RMB-[A-Z0-9]+$/, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: /^You're booked/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Confirmation RMB-[A-Z0-9]+/)).toBeVisible();
  await reportAxeViolations(page, testInfo, 'confirmation');
});
