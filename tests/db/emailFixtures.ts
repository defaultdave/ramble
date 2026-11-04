import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { messages } from '@/server/db/schema';
import { server } from '../msw/server';
import { setEnv, webhookSecret } from '../email/testEnv';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

/** The object a file's `vi.mock('@/server/env')` factory returns; `setMode` swaps its contents. */
export const testEnv: Record<string, unknown> = {};

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
export let client: typeof import('@/server/db/client');
export let email: typeof import('@/server/ports/email');
export let webhook: typeof import('@/server/ports/email/webhook');
export let errors: typeof import('@/server/ports/email/errors');
export let log: typeof import('@/server/db/messages');

/** Opens a fresh database for the file that calls it, serves it over the Neon HTTP shim, and loads the email modules. */
export function setupEmailDatabase() {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    stopHttp = await serveNeonHttp(fresh.url);
    setEnv(testEnv, { DATABASE_URL: fresh.url });
    client = await import('@/server/db/client');
    email = await import('@/server/ports/email');
    webhook = await import('@/server/ports/email/webhook');
    errors = await import('@/server/ports/email/errors');
    log = await import('@/server/db/messages');
    server.listen({ onUnhandledFrame: 'bypass' });
  });

  afterAll(async () => {
    server.close();
    await client.db.$client.end();
    await stopHttp();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    setMode({ EMAIL_WEBHOOK_SECRET: webhookSecret });
  });

  afterEach(() => {
    server.resetHandlers();
  });
}

export const signingSecret = `whsec_${Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').toString('base64')}`;
export const resendSettings = {
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM: 'Ramble <hello@ramble.example>',
  EMAIL_REPLY_TO: 'support@ramble.example',
  EMAIL_WEBHOOK_SECRET: signingSecret,
};

export const live = { ...resendSettings, EMAIL_MODE: 'live' };

export function setMode(overrides: Record<string, unknown> = {}) {
  setEnv(testEnv, { DATABASE_URL: fresh.url, ...overrides });
}

let counter = 0;
export function request(
  overrides: Partial<
    Extract<
      Parameters<typeof import('@/server/ports/email').sendEmail>[0],
      { template: 'dev-check' }
    >
  > = {},
) {
  counter += 1;
  return {
    template: 'dev-check' as const,
    to: `guest${String(counter)}@example.com`,
    data: { recipientName: 'Sam' },
    idempotencyKey: `key-${String(counter)}`,
    ...overrides,
  };
}

export async function rowFor(idempotencyKey: string) {
  const [row] = await client.db
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
  if (!row) throw new Error(`no message with key ${idempotencyKey}`);
  return row;
}

export async function rowsFor(idempotencyKey: string) {
  return client.db
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
}

export function resendAccepts() {
  const calls: { key: string | null; body: string }[] = [];
  server.use(
    http.post('https://api.resend.com/emails', async ({ request: sent }) => {
      calls.push({
        key: sent.headers.get('idempotency-key'),
        body: await sent.text(),
      });
      return HttpResponse.json({ id: `re_${randomUUID()}` });
    }),
  );
  return calls;
}

export function resendRefuses(status: number) {
  const calls: number[] = [];
  server.use(
    http.post('https://api.resend.com/emails', () => {
      calls.push(status);
      return HttpResponse.json({ message: 'refused' }, { status });
    }),
  );
  return calls;
}

export function post(body: string, headers: Record<string, string>) {
  return webhook.deliveryWebhookResponse(
    new Request('http://localhost/api/webhooks/email', {
      method: 'POST',
      body,
      headers,
    }),
    Math.floor(Date.now() / 1000),
  );
}

export const fakeEvent = (providerMessageId: string, event: string) =>
  post(JSON.stringify({ messageId: providerMessageId, event }), {
    authorization: `Bearer ${webhookSecret}`,
  });
