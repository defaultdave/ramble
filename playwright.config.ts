import { defineConfig, devices } from '@playwright/test';
import { e2eMailboxSecret, e2eWebhookSecret } from './e2e/secrets';

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
    baseURL: `http://localhost:${String(port)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${String(port)}`,
    url: `http://localhost:${String(port)}`,
    env: {
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      DEV_MAILBOX_SECRET: e2eMailboxSecret,
      EMAIL_WEBHOOK_SECRET: e2eWebhookSecret,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
