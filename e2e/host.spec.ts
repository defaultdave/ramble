import { expect, test } from './fixtures';
import { hostDashboardPath } from './routes';

// The signed-in dashboard needs a database and a session, which this server does not have; its
// states are covered by the component and database tests. What a visitor sees is covered here.

test('the host dashboard sends a visitor to sign in and back', async ({
  page,
}) => {
  await page.goto(hostDashboardPath);

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhost$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible();
});
