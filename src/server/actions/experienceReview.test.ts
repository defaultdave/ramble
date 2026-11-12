import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  decideExperienceReview: vi.fn(),
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
vi.mock('@/server/db/experienceReview', () => ({
  decideExperienceReview: mocks.decideExperienceReview,
}));

import {
  approveExperienceAction,
  rejectExperienceAction,
} from './experienceReview';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role is sent to the queue and nothing is decided
// - an experience id that is not an id goes to the queue and nothing is decided
// - an approval or rejection that goes through returns to the queue with its notice
// - a rejection with no reason, or an unknown one, goes back to the experience with a notice and decides nothing
// - the reason posted is the one passed on
// - a refused approval goes back to the experience naming the photos
// - an experience no longer in review goes back to it with that notice; a missing one goes to the queue

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };
const queue = '/ops/review';
const item = `/ops/review/${id(9)}`;

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
  ['approve', approveExperienceAction, {}],
  ['reject', rejectExperienceAction, { reason: 'photos' }],
])('the %s action', (_name, action, extra) => {
  const posted = { experienceId: id(9), ...extra };

  it.each([
    ['an admin', { userId: id(1), roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the queue and decides nothing', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    expect(await redirectOf(() => action(formOf(posted)))).toBe(queue);
    expect(mocks.decideExperienceReview).not.toHaveBeenCalled();
  });

  it('sends a form with no experience id to the queue and decides nothing', async () => {
    expect(await redirectOf(() => action(formOf(extra)))).toBe(queue);
    expect(mocks.decideExperienceReview).not.toHaveBeenCalled();
  });

  it.each([
    ['approved', `${queue}?notice=approved`],
    ['rejected', `${queue}?notice=rejected`],
  ])('returns to the queue after a decision, %s', async (status, href) => {
    mocks.decideExperienceReview.mockResolvedValue({ status });

    expect(await redirectOf(() => action(formOf(posted)))).toBe(href);
  });

  it('goes back to the experience when it is no longer in review', async () => {
    mocks.decideExperienceReview.mockResolvedValue({ status: 'not_in_review' });

    expect(await redirectOf(() => action(formOf(posted)))).toBe(
      `${item}?notice=not_in_review`,
    );
  });

  it('goes to the queue for an experience that is not there', async () => {
    mocks.decideExperienceReview.mockResolvedValue({ status: 'not_found' });

    expect(await redirectOf(() => action(formOf(posted)))).toBe(queue);
  });
});

describe('approving', () => {
  it('asks for an approval', async () => {
    mocks.decideExperienceReview.mockResolvedValue({ status: 'approved' });

    await redirectOf(() =>
      approveExperienceAction(formOf({ experienceId: id(9) })),
    );

    expect(mocks.decideExperienceReview).toHaveBeenCalledWith(ops, id(9), {
      kind: 'approve',
    });
  });

  it('goes back to the experience naming the photos the check refused', async () => {
    mocks.decideExperienceReview.mockResolvedValue({
      status: 'alt_missing',
      photoNumbers: [2, 4],
    });

    expect(
      await redirectOf(() =>
        approveExperienceAction(formOf({ experienceId: id(9) })),
      ),
    ).toBe(`${item}?notice=alt_missing&fields=2%2C4`);
  });
});

describe('approving for a host that is suspended', () => {
  it('goes back to the experience with that notice', async () => {
    mocks.decideExperienceReview.mockResolvedValue({
      status: 'host_suspended',
    });

    expect(
      await redirectOf(() =>
        approveExperienceAction(formOf({ experienceId: id(9) })),
      ),
    ).toBe(`${item}?notice=host_suspended`);
  });
});

describe('rejecting', () => {
  it('passes on the reason posted', async () => {
    mocks.decideExperienceReview.mockResolvedValue({ status: 'rejected' });

    await redirectOf(() =>
      rejectExperienceAction(formOf({ experienceId: id(9), reason: 'prices' })),
    );

    expect(mocks.decideExperienceReview).toHaveBeenCalledWith(ops, id(9), {
      kind: 'reject',
      reason: 'prices',
    });
  });

  it.each([[{}], [{ reason: '' }], [{ reason: 'spam' }]])(
    'goes back asking for a reason when the form carries %j, and decides nothing',
    async (extra) => {
      const href = await redirectOf(() =>
        rejectExperienceAction(formOf({ experienceId: id(9), ...extra })),
      );

      expect(href).toBe(`${item}?notice=no_reason`);
      expect(mocks.decideExperienceReview).not.toHaveBeenCalled();
    },
  );
});
