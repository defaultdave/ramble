import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelSessionAsOps: vi.fn(),
  opsCallerOrLeave: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/opsAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/opsAccess')>()),
  opsCallerOrLeave: mocks.opsCallerOrLeave,
}));
vi.mock('@/server/db/opsSessions', () => ({
  cancelSessionAsOps: mocks.cancelSessionAsOps,
}));

import { cancelOpsSessionAction } from './opsSessions';

// Behaviours under test:
// - the caller is checked first: a caller sent away reads nothing and changes nothing
// - a form with no session id leaves for the list
// - a refused form redirects to the session with the invalid notice and changes nothing
// - each outcome redirects to the session with the notice it names
// - the parsed input, fingerprint included, reaches the data layer with the ops caller

const sessionId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const page = `/ops/sessions/${sessionId}`;
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const fields = {
  reason: 'weather',
  fingerprint: '1:10800:0:2:1:0',
  confirm: 'on',
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

async function redirectOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirected) return error.href;
    throw error;
  }
  throw new Error('The action did not redirect');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe('cancelOpsSessionAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/sessions'));
    await expect(
      cancelOpsSessionAction(form({ sessionId, ...fields })),
    ).rejects.toMatchObject({ href: '/ops/sessions' });
    expect(mocks.cancelSessionAsOps).not.toHaveBeenCalled();
  });

  it('leaves for the list when the form carries no session id', async () => {
    expect(await redirectOf(() => cancelOpsSessionAction(form(fields)))).toBe(
      '/ops/sessions',
    );
  });

  it.each([
    ['no fingerprint', { fingerprint: '' }],
    ['the box not ticked', { confirm: '' }],
  ])(
    'redirects with the invalid notice for a form with %s, and cancels nothing',
    async (_name, over) => {
      const values = Object.fromEntries(
        Object.entries({ sessionId, ...fields, ...over }).filter(
          ([, value]) => value !== '',
        ),
      );
      expect(await redirectOf(() => cancelOpsSessionAction(form(values)))).toBe(
        `${page}?notice=invalid`,
      );
      expect(mocks.cancelSessionAsOps).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'stale' }, 'stale'],
    [{ kind: 'ended' }, 'in_the_past'],
    [
      {
        kind: 'done',
        result: {
          status: 'cancelled',
          ordersRefunded: 1,
          ordersVoided: 0,
          holdsReleased: 0,
          attemptsLeft: 0,
        },
      },
      'cancelled',
    ],
    [{ kind: 'done', result: { status: 'not_found' } }, 'not_found'],
  ])('names the notice for outcome %#', async (outcome, notice) => {
    mocks.cancelSessionAsOps.mockResolvedValue(outcome);
    expect(
      await redirectOf(() =>
        cancelOpsSessionAction(form({ sessionId, ...fields })),
      ),
    ).toBe(`${page}?notice=${notice}`);
    expect(mocks.cancelSessionAsOps).toHaveBeenCalledWith(ops, {
      sessionId,
      reason: 'weather',
      fingerprint: '1:10800:0:2:1:0',
    });
  });
});
