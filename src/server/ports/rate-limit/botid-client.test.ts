import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initBotId = vi.hoisted(() => vi.fn());
vi.mock('botid/client/core', () => ({ initBotId }));

import { startBotChallenge } from './botid-client';

// Behaviours under test:
// - a guest page starts the challenge for POSTs to experience pages
// - checkout, gift, manage, orders, host, and ops paths start nothing
// - the files the browser loads before hydration pull in no Zod

beforeEach(() => {
  initBotId.mockReset();
});

describe('startBotChallenge', () => {
  it.each(['/', '/experiences/sunrise-kayak', '/browse'])(
    'starts the challenge on %s',
    async (pathname) => {
      await startBotChallenge(pathname);

      expect(initBotId).toHaveBeenCalledExactlyOnceWith({
        protect: [{ path: '/experiences/*', method: 'POST' }],
      });
    },
  );

  it.each([
    '/checkout',
    '/checkout/step/2',
    '/gifts/checkout',
    '/gift/abc',
    '/manage/token',
    '/orders/1',
    '/host/sessions',
    '/ops',
  ])('starts nothing on %s', async (pathname) => {
    await startBotChallenge(pathname);

    expect(initBotId).not.toHaveBeenCalled();
  });
});

describe('what the browser loads', () => {
  it.each([
    'src/server/ports/rate-limit/botid-client.ts',
    'src/lib/botChallenge.ts',
    'src/lib/securityHeaders.ts',
    'src/instrumentation-client.ts',
  ])('%s imports no Zod, which Chromium reports as a CSP violation', (file) => {
    const text = readFileSync(
      path.resolve(import.meta.dirname, '../../../..', file),
      'utf8',
    );

    expect(text).not.toMatch(/from 'zod'|from "zod"|\/zod/);
  });
});
