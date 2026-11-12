import { defineConfig, devices } from '@playwright/test';

const bookingPathSpec = /booking-path\.spec\.ts$/;
const port = 3100;
const seededPort = 3101;
const neonShimPort = 4444;

// The main suite runs against a server with no database behind it: it needs URLs that pass
// validation, and its specs rely on a read failing fast. Nothing connects to the placeholder: port 1
// is one nothing listens on, so a read is refused at once. Port 5432 is where CI's Postgres (and
// the local `docker compose` one) answers, and a server that answers and refuses the login fails
// more slowly, which let a page's 200 go out before its not-found was thrown (hosts.spec.ts).
const databaseUrl =
  'postgres://placeholder:placeholder@127.0.0.1:1/placeholder';

// Set to a migrated, seeded Postgres (`pnpm e2e:db` prepares one) to also run the booking path on a
// second server that reads it. Left unset, that spec skips and nothing else changes.
const seededDatabaseUrl = process.env.E2E_DATABASE_URL;

const serverEnv = {
  DEV_MAILBOX_SECRET: 'e2e-mailbox-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  // Read when the guest pages are built, so it reaches the build step of the command below.
  // Fake: e2e/fixtures.ts answers the loader request locally, and checkout-no-sentry.spec.ts
  // uses it to show the loader is on for guests and absent from checkout.
  SENTRY_BROWSER_DSN:
    'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/1',
};

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-chromium',
      testIgnore: bookingPathSpec,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'booking-path',
      testMatch: bookingPathSpec,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${String(seededPort)}`,
      },
    },
  ],
  // Servers start in this order: the first one builds, and the third reuses that build.
  webServer: [
    {
      command: `pnpm build && pnpm start --port ${String(port)}`,
      url: `http://localhost:${String(port)}`,
      env: {
        ...serverEnv,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_UNPOOLED: databaseUrl,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    ...(seededDatabaseUrl
      ? [
          {
            // Guest pages read through Neon's HTTP driver, which cannot reach a plain Postgres.
            command: 'pnpm db:http',
            port: neonShimPort,
            env: { DATABASE_URL: seededDatabaseUrl },
            reuseExistingServer: !process.env.CI,
          },
          {
            command: `pnpm start --port ${String(seededPort)}`,
            url: `http://localhost:${String(seededPort)}`,
            env: {
              ...serverEnv,
              // Fake, like the rest: it only derives the order link the pay step ends on.
              CAPABILITY_TOKEN_SECRET:
                'e2e-capability-secret-xxxxxxxxxxxxxxxxxxxxxxxxx',
              DATABASE_URL: seededDatabaseUrl,
              DATABASE_URL_UNPOOLED: seededDatabaseUrl,
              NEON_HTTP_ENDPOINT: `http://127.0.0.1:${String(neonShimPort)}/sql`,
            },
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ]
      : []),
  ],
});
