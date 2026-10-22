import { defineConfig, devices } from '@playwright/test';

const port = 3100;

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
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
