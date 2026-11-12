import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  setExperiencePaused: vi.fn(),
  setHostSuspended: vi.fn(),
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
vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/experiencePause', () => ({
  setExperiencePaused: mocks.setExperiencePaused,
  setHostSuspended: mocks.setHostSuspended,
}));

import {
  pauseExperienceAction,
  suspendHostAction,
  unpauseExperienceAction,
  unsuspendHostAction,
} from './experiencePause';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role is sent to the list and nothing changes
// - a form with no id, or one that is not an id, goes to the list and nothing changes
// - the experience actions ask for a pause or an unpause and return to the experience with the outcome's notice
// - the host actions ask for a suspend or an unsuspend and return to the host with the outcome's notice
// - a refusal or an empty change comes back as its notice, and nothing is invented
// - an experience or host that is not there goes to the list

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };

function formOf(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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
  mocks.readOpsCaller.mockResolvedValue(ops);
});

describe.each([
  [
    'experience',
    [pauseExperienceAction, unpauseExperienceAction],
    'experienceId',
    '/ops/experiences',
    mocks.setExperiencePaused,
    'paused',
  ],
  [
    'host',
    [suspendHostAction, unsuspendHostAction],
    'hostId',
    '/ops/hosts',
    mocks.setHostSuspended,
    'suspended',
  ],
] as const)('the %s actions', (_name, actions, field, list, change, done) => {
  it.each([
    ['an admin', { userId: id(1), roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the list and changes nothing', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    for (const action of actions) {
      expect(await redirectOf(() => action(formOf({ [field]: id(9) })))).toBe(
        list,
      );
    }
    expect(change).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ [field]: 'not-an-id' }]])(
    'sends a form carrying %j to the list and changes nothing',
    async (posted) => {
      for (const action of actions) {
        expect(await redirectOf(() => action(formOf(posted)))).toBe(list);
      }
      expect(change).not.toHaveBeenCalled();
    },
  );

  it('asks for the first action, then the second, and returns to the row with the notice', async () => {
    change.mockResolvedValue({ status: done });
    const [first, second] = actions;

    expect(await redirectOf(() => first(formOf({ [field]: id(9) })))).toBe(
      `${list}/${id(9)}?notice=${done}`,
    );
    await redirectOf(() => second(formOf({ [field]: id(9) })));

    expect(change.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      'pause',
      'unpause',
    ]);
    expect(change).toHaveBeenCalledWith(ops, id(9), 'pause');
  });

  it('returns to the row with the refusal as its notice', async () => {
    change.mockResolvedValue({ status: 'not_live' });
    const [first] = actions;

    expect(await redirectOf(() => first(formOf({ [field]: id(9) })))).toBe(
      `${list}/${id(9)}?notice=not_live`,
    );
  });

  it('goes to the list for a row that is not there', async () => {
    change.mockResolvedValue({ status: 'not_found' });
    const [first] = actions;

    expect(await redirectOf(() => first(formOf({ [field]: id(9) })))).toBe(
      list,
    );
  });
});
