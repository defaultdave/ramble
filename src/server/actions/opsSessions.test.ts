import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelSessionAsOps: vi.fn(),
  changeAllocationAsOps: vi.fn(),
  pauseExperienceAndCancel: vi.fn(),
  opsCallerOrLeave: vi.fn(),
  logError: vi.fn(),
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
  changeAllocationAsOps: mocks.changeAllocationAsOps,
  pauseExperienceAndCancel: mocks.pauseExperienceAndCancel,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: mocks.logError },
}));

import { PauseIncompleteError } from '@/lib/opsSessions';
import {
  cancelOpsSessionAction,
  changeOpsAllocationAction,
  pauseOpsExperienceAction,
} from './opsSessions';

// Behaviours under test:
// - the caller is checked first: a caller sent away reads nothing and changes nothing
// - a form with no session id leaves for the list
// - a refused form redirects to the session with the invalid notice and changes nothing
// - each outcome redirects to the session with the notice it names
// - the parsed input, fingerprint included, reaches the data layer with the ops caller
// - a capacity result redirects with the notice it names, and a refused capacity form changes nothing
// - a pause outcome redirects with its notice and counts; a pause that stops part-way is told with how far it got and logs the error kind only; any other failure is not swallowed

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

describe('changeOpsAllocationAction', () => {
  const values = { sessionId, allocation: '9', expectedVersion: '2' };

  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/sessions'));
    await expect(changeOpsAllocationAction(form(values))).rejects.toMatchObject(
      { href: '/ops/sessions' },
    );
    expect(mocks.changeAllocationAsOps).not.toHaveBeenCalled();
  });

  it('redirects with the invalid notice for a capacity that is no number, and changes nothing', async () => {
    expect(
      await redirectOf(() =>
        changeOpsAllocationAction(form({ ...values, allocation: 'many' })),
      ),
    ).toBe(`${page}?notice=invalid`);
    expect(mocks.changeAllocationAsOps).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: true }, 'allocation_saved'],
    [{ ok: false, reason: 'below_sold_and_held' }, 'below_sold_and_held'],
    [{ ok: false, reason: 'version_conflict' }, 'version_conflict'],
  ])('names the notice for result %#', async (result, notice) => {
    mocks.changeAllocationAsOps.mockResolvedValue(result);
    expect(
      await redirectOf(() => changeOpsAllocationAction(form(values))),
    ).toBe(`${page}?notice=${notice}`);
    expect(mocks.changeAllocationAsOps).toHaveBeenCalledWith(ops, {
      sessionId,
      allocation: 9,
      expectedVersion: 2,
    });
  });
});

describe('pauseOpsExperienceAction', () => {
  const values = { sessionId, fingerprint: '1:10800:0:2:1:0', confirm: 'on' };

  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/sessions'));
    await expect(pauseOpsExperienceAction(form(values))).rejects.toMatchObject({
      href: '/ops/sessions',
    });
    expect(mocks.pauseExperienceAndCancel).not.toHaveBeenCalled();
  });

  it('redirects with the invalid notice when the box is not ticked, and pauses nothing', async () => {
    expect(
      await redirectOf(() =>
        pauseOpsExperienceAction(
          form({ sessionId, fingerprint: '1:1:1:1:1:1' }),
        ),
      ),
    ).toBe(`${page}?notice=invalid`);
    expect(mocks.pauseExperienceAndCancel).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        status: 'paused',
        cancelled: 2,
        alreadyCancelled: 0,
        total: 2,
        left: 0,
      },
      'notice=paused&done=2&of=2',
    ],
    [
      {
        status: 'paused',
        cancelled: 1,
        alreadyCancelled: 0,
        total: 2,
        left: 1,
      },
      'notice=paused_some_left&done=1&of=2',
    ],
    [{ status: 'stale' }, 'notice=stale'],
    [{ status: 'blocked' }, 'notice=blocked'],
    [{ status: 'not_pausable' }, 'notice=not_pausable'],
  ])('sends outcome %# on with its notice', async (outcome, query) => {
    mocks.pauseExperienceAndCancel.mockResolvedValue(outcome);
    expect(await redirectOf(() => pauseOpsExperienceAction(form(values)))).toBe(
      `${page}?${query}`,
    );
    expect(mocks.pauseExperienceAndCancel).toHaveBeenCalledWith(ops, {
      sessionId,
      fingerprint: '1:10800:0:2:1:0',
    });
  });

  it('tells a pause that stopped part-way how far it got, and logs the kind of the error and nothing else', async () => {
    mocks.pauseExperienceAndCancel.mockRejectedValue(
      new PauseIncompleteError(1, 3, new RangeError('secret query text')),
    );
    expect(await redirectOf(() => pauseOpsExperienceAction(form(values)))).toBe(
      `${page}?notice=pause_incomplete&done=1&of=3`,
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      'pausing an experience stopped part-way',
      { errorKind: 'RangeError', cancelled: 1, total: 3 },
    );
  });

  it('does not swallow any other failure', async () => {
    mocks.pauseExperienceAndCancel.mockRejectedValue(new Error('boom'));
    await expect(pauseOpsExperienceAction(form(values))).rejects.toThrow(
      'boom',
    );
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
