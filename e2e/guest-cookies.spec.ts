import { expect, test } from './fixtures';
import { routes, unknownPaths, unprerenderedParamPath } from './routes';

// The CDN stores a response only when it carries no cookie and does not vary on one (ADR 0001).
const guestPaths = [
  ...routes.filter(({ group }) => group === 'guest').map(({ path }) => path),
  unknownPaths.guest,
  unprerenderedParamPath,
];

for (const path of guestPaths) {
  test(`${path} sends no cookies`, async ({ page, context }) => {
    const response = await page.goto(path);
    expect(response).not.toBeNull();

    const headers = (await response?.headersArray()) ?? [];
    const setCookies = headers.filter(
      ({ name }) => name.toLowerCase() === 'set-cookie',
    );
    const varied = headers
      .filter(({ name }) => name.toLowerCase() === 'vary')
      .flatMap(({ value }) => value.split(','))
      .map((field) => field.trim().toLowerCase());

    expect(setCookies).toEqual([]);
    expect(varied).not.toContain('cookie');
    // Catches a cookie written by a script as well as one set by a header.
    expect(await context.cookies()).toEqual([]);
  });
}
