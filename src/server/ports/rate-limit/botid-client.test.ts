import { beforeEach, describe, expect, it, vi } from 'vitest';

const initBotId = vi.hoisted(() => vi.fn());
vi.mock('botid/client/core', () => ({ initBotId }));

import { startBotChallenge } from './botid-client';

// Behaviours under test:
// - a guest page starts the challenge for POSTs to experience pages
// - checkout, gift, manage, orders, host, and ops paths start nothing

beforeEach(() => {
  initBotId.mockReset();
});

describe('startBotChallenge', () => {
  it.each(['/', '/experiences/sunrise-kayak', '/browse'])(
    'starts the challenge on %s',
    (pathname) => {
      startBotChallenge(pathname);

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
  ])('starts nothing on %s', (pathname) => {
    startBotChallenge(pathname);

    expect(initBotId).not.toHaveBeenCalled();
  });
});
