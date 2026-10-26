import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  notFoundHeading,
  perRequestFallbackPaths,
  perRequestGroups,
  routes,
  unknownPaths,
  unknownPathStatus,
  unprerenderedParamPath,
  type RouteGroup,
} from './routes';

type HeaderRow = { name: string; value: string };

type PathRow = {
  path: string;
  dynamic: boolean;
  status: number;
  heading?: string;
};

const paths: readonly PathRow[] = [
  ...routes.map(({ path, group }) => ({
    path,
    dynamic: perRequestGroups.has(group),
    status: 200,
  })),
  ...(Object.entries(unknownPaths) as [RouteGroup, string][]).map(
    ([group, path]) => ({
      path,
      dynamic: perRequestGroups.has(group),
      status: unknownPathStatus(group),
    }),
  ),
  ...perRequestFallbackPaths.map((path) => ({
    path,
    dynamic: true,
    status: 200,
    heading: notFoundHeading,
  })),
  { path: unprerenderedParamPath, dynamic: false, status: 200 },
];

const staticHeaders: readonly HeaderRow[] = [
  {
    name: 'strict-transport-security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { name: 'x-content-type-options', value: 'nosniff' },
  { name: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
  { name: 'x-frame-options', value: 'DENY' },
  {
    name: 'permissions-policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=()',
  },
  { name: 'cross-origin-opener-policy', value: 'same-origin' },
  { name: 'cross-origin-resource-policy', value: 'same-origin' },
];

const enforced = 'content-security-policy';
const reportOnly = 'content-security-policy-report-only';

function headerValues(headers: HeaderRow[], name: string): string[] {
  return headers
    .filter((header) => header.name.toLowerCase() === name)
    .map(({ value }) => value);
}

function directive(policy: string, name: string): string {
  return (
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''
  );
}

function nonceOf(policy: string): string {
  const nonce = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(policy)?.[1];
  expect(nonce, `no nonce in ${policy}`).toBeDefined();
  return nonce ?? '';
}

function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/g) ?? [];
}

/** External scripts the browser will fetch: a `noModule` script is skipped by any browser that runs modules. */
function scriptSources(html: string): string[] {
  return scriptTags(html).flatMap((tag) => {
    if (/\bnoModule\b/i.test(tag)) return [];
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    return src ? [new URL(src, 'http://localhost').pathname] : [];
  });
}

declare global {
  interface Window {
    __cspViolations?: string[];
    next?: { router?: unknown };
  }
}

/** Chromium logs a 404 document as a resource error; that line is the expected status, not a fault. */
function isDocumentStatusLine(text: string, status: number): boolean {
  return (
    status !== 200 &&
    text ===
      `Failed to load resource: the server responded with a status of ${String(status)} (Not Found)`
  );
}

async function watchViolations(page: Page, status: number): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isDocumentStatusLine(text, status)) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.disposition} ${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return consoleErrors;
}

for (const { path, dynamic, status, heading } of paths) {
  test(`${path} carries the security header set`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(status);
    const headers = (await response?.headersArray()) ?? [];

    for (const { name, value } of staticHeaders) {
      expect(headerValues(headers, name), name).toEqual([value]);
    }
  });

  if (dynamic) {
    test(`${path} enforces a nonce policy that its scripts satisfy`, async ({
      page,
    }) => {
      const consoleErrors = await watchViolations(page, status);

      const response = await page.goto(path);
      expect(response?.status()).toBe(status);
      const headers = (await response?.headersArray()) ?? [];
      expect(headerValues(headers, reportOnly)).toEqual([]);

      const [policy] = headerValues(headers, enforced);
      expect(policy).toBeDefined();
      const scriptSrc = directive(policy ?? '', 'script-src');
      expect(scriptSrc).toContain("'strict-dynamic'");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      const nonce = nonceOf(policy ?? '');

      const html = (await response?.text()) ?? '';
      const tags = scriptTags(html);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toContain(`nonce="${nonce}"`);
      }

      await expect(page.getByRole('main')).toBeVisible();
      if (heading) {
        await expect(
          page.getByRole('heading', { level: 1, name: heading }),
        ).toBeVisible();
      }
      await page.waitForLoadState('networkidle');

      // A blocked script never issues a request, so every external script in the
      // document must show up in the resource timeline, and the inline bootstrap
      // must have run for the flight data to exist.
      const loaded = await page.evaluate(() => ({
        // A script Next.js preloaded has its one entry under the preload link, so no initiator filter.
        scripts: performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name).pathname),
        hydrated:
          typeof window.next?.router === 'object' &&
          Object.keys(document.body).some((key) =>
            key.startsWith('__reactFiber'),
          ),
        violations: window.__cspViolations ?? [],
      }));
      for (const source of scriptSources(html)) {
        expect(loaded.scripts, source).toContain(source);
      }
      expect(loaded.hydrated).toBe(true);
      expect(loaded.violations).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  } else {
    test(`${path} reports only, with no nonce, and loads clean`, async ({
      page,
    }) => {
      const consoleErrors = await watchViolations(page, status);

      const response = await page.goto(path);
      expect(response?.status()).toBe(status);
      const headers = (await response?.headersArray()) ?? [];
      expect(headerValues(headers, enforced)).toEqual([]);

      const [policy] = headerValues(headers, reportOnly);
      expect(policy).toBeDefined();
      expect(policy).not.toContain('nonce-');
      expect(policy).toContain("frame-ancestors 'none'");

      await expect(page.getByRole('main')).toBeVisible();
      await page.waitForLoadState('networkidle');

      const violations = await page.evaluate(
        () => window.__cspViolations ?? [],
      );
      expect(violations).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
}

test('every dynamic response gets its own nonce', async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const response = await request.get('/ops');
    nonces.add(nonceOf(response.headers()[enforced] ?? ''));
  }
  expect(nonces.size).toBe(3);
});

const attackerPolicy = "script-src 'nonce-ATTACKER'";

test.describe('a client-supplied policy header', () => {
  test('never reaches the scripts of a dynamic page', async ({ request }) => {
    const response = await request.get('/ops', {
      headers: { [enforced]: attackerPolicy },
    });
    const nonce = nonceOf(response.headers()[enforced] ?? '');
    const html = await response.text();
    expect(html).not.toContain('ATTACKER');
    for (const tag of scriptTags(html)) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  test('never reaches the scripts of a cached page', async ({ request }) => {
    const response = await request.get('/', {
      headers: {
        [enforced]: attackerPolicy,
        [reportOnly]: attackerPolicy,
      },
    });
    expect(response.headers()[enforced]).toBeUndefined();
    expect(await response.text()).not.toContain('ATTACKER');
  });

  test('never reaches a prefetched document, which still gets its tier', async ({
    request,
  }) => {
    const response = await request.get('/ops', {
      headers: { [enforced]: attackerPolicy, purpose: 'prefetch' },
    });
    expect(response.status()).toBe(200);
    const nonce = nonceOf(response.headers()[enforced] ?? '');
    const html = await response.text();
    expect(html).not.toContain('ATTACKER');
    const tags = scriptTags(html);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });
});

test.describe('the proxy matcher', () => {
  test('covers a path that only starts with "api"', async ({ request }) => {
    const response = await request.get('/apiary');
    expect(response.headers()[reportOnly]).toBeDefined();
  });

  test('skips the favicon path alone', async ({ request }) => {
    const response = await request.get('/favicon.ico');
    expect(response.headers()[enforced]).toBeUndefined();
    expect(response.headers()[reportOnly]).toBeUndefined();
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });
});

test('/.well-known/security.txt is served as text', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain\b/);
  const body = await response.text();
  expect(body).toMatch(/^Contact: /m);
  expect(body).toMatch(/^Expires: /m);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
