import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  getCaller: vi.fn(),
  cancelSessionAsHost: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/auth/caller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/caller')>()),
  getCaller: mocks.getCaller,
}));
vi.mock('@/server/db/hostCancelSession', () => ({
  cancelSessionAsHost: mocks.cancelSessionAsHost,
}));

import { ForbiddenError, Role } from '@/server/auth/caller';
import { cancelHostSessionAction } from './hostCancelSession';

// Behaviours under test, one per decision, branch or risk:
// - a form with no session id leaves for the week and calls nothing
// - a form without the ticked box or the impact read goes back to the cancel page saying so, and cancels nothing
// - nobody signed in, a guest, host staff, ops and admin are sent back to the cancel page and nothing is cancelled
// - an owner cancels for the host in their own grant, never one named in the form, and the page names what came of it
// - a refusal from the data layer (the grant moved on) is sent back to the page like any other; any other failure is not hidden
// - a cancelled session refreshes the week page

const hostId = id(9);
const sessionId = id(5);
const fingerprint = '2:21600:1:2:1:0';
const page = `/host/sessions/${sessionId}/cancel`;
const owner = {
  userId: id(1),
  roles: ['guest', 'host_owner'],
  hostIds: [hostId],
  hostGrants: [{ role: 'host_owner', hostId }],
};
const cancelled = {
  kind: 'done',
  result: {
    status: 'cancelled',
    ordersRefunded: 2,
    ordersVoided: 0,
    holdsReleased: 0,
    attemptsLeft: 0,
  },
};

function formOf(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const confirmed = { sessionId, fingerprint, confirm: 'on' };

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
  mocks.getCaller.mockResolvedValue(owner);
  mocks.cancelSessionAsHost.mockResolvedValue(cancelled);
});

describe('cancelHostSessionAction', () => {
  it.each([{}, { sessionId: 'not-an-id', fingerprint, confirm: 'on' }])(
    'leaves for the week when the form names no session: %j',
    async (fields) => {
      expect(
        await redirectOf(() => cancelHostSessionAction(formOf(fields))),
      ).toBe('/host/sessions');
      expect(mocks.cancelSessionAsHost).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['the box is not ticked', { sessionId, fingerprint }],
    ['the impact was not read', { sessionId, confirm: 'on' }],
  ])(
    'goes back saying so when %s, and cancels nothing',
    async (_why, fields) => {
      expect(
        await redirectOf(() => cancelHostSessionAction(formOf(fields))),
      ).toBe(`${page}?notice=invalid`);
      expect(mocks.getCaller).not.toHaveBeenCalled();
      expect(mocks.cancelSessionAsHost).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['nobody signed in', { userId: null, roles: [], hostIds: [] }],
    ['a guest', { userId: id(2), roles: ['guest'], hostIds: [] }],
    [
      'host staff',
      {
        userId: id(3),
        roles: ['host_staff'],
        hostIds: [hostId],
        hostGrants: [{ role: 'host_staff', hostId }],
      },
    ],
    ['ops', { userId: id(4), roles: ['ops'], hostIds: [] }],
    ['an admin', { userId: id(6), roles: ['admin'], hostIds: [] }],
  ])('sends %s back to the page and cancels nothing', async (_who, caller) => {
    mocks.getCaller.mockResolvedValue(caller);
    expect(
      await redirectOf(() => cancelHostSessionAction(formOf(confirmed))),
    ).toBe(page);
    expect(mocks.cancelSessionAsHost).not.toHaveBeenCalled();
  });

  it('cancels for the host in the owner’s grant, never the one the form names', async () => {
    const href = await redirectOf(() =>
      cancelHostSessionAction(formOf({ ...confirmed, hostId: id(8) })),
    );

    expect(mocks.cancelSessionAsHost).toHaveBeenCalledExactlyOnceWith(
      owner,
      hostId,
      { sessionId, fingerprint },
    );
    expect(href).toBe(`${page}?notice=cancelled`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/host/sessions');
  });

  it.each([
    [{ kind: 'stale' }, 'stale'],
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'ended' }, 'in_the_past'],
    [{ kind: 'done', result: { status: 'not_found' } }, 'not_found'],
  ])('names %j as %s on the page', async (outcome, notice) => {
    mocks.cancelSessionAsHost.mockResolvedValue(outcome);
    expect(
      await redirectOf(() => cancelHostSessionAction(formOf(confirmed))),
    ).toBe(`${page}?notice=${notice}`);
  });

  it('sends a refusal from the data layer back to the page', async () => {
    mocks.cancelSessionAsHost.mockRejectedValue(
      new ForbiddenError(Role.HostOwner),
    );
    expect(
      await redirectOf(() => cancelHostSessionAction(formOf(confirmed))),
    ).toBe(page);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not hide any other failure', async () => {
    mocks.cancelSessionAsHost.mockRejectedValue(new Error('database down'));
    await expect(cancelHostSessionAction(formOf(confirmed))).rejects.toThrow(
      'database down',
    );
  });
});
