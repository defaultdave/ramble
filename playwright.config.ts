import { defineConfig, devices } from '@playwright/test';

const port = 3100;

// The pages read no data yet, so the server only needs URLs that pass validation. Nothing
// connects to them. Replace with a real service container when a page queries the database.
const databaseUrl =
  'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    env: { DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
