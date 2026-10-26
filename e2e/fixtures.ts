import { expect, test as base } from '@playwright/test';

// The e2e server is built with a fake SENTRY_BROWSER_DSN, so guest pages ask for Sentry's loader
// script. Nothing may leave the machine, so the request is answered here with an empty script.
export const sentryLoaderUrl = /^https:\/\/js\.sentry-cdn\.com\//;

export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route(sentryLoaderUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
      }),
    );
    await provide(context);
  },
});

export { expect };
