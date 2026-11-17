import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  setReviewVisibility: vi.fn(),
  updateTagsForChanges: vi.fn(),
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
vi.mock('@/server/opsAccess', () => ({
  opsCallerOrLeave: mocks.opsCallerOrLeave,
}));
vi.mock('@/server/db/reviewModeration', () => ({
  setReviewVisibility: mocks.setReviewVisibility,
}));
vi.mock('@/server/cache/invalidate', () => ({
  updateTagsForChanges: mocks.updateTagsForChanges,
}));

import { hideReviewAction, unhideReviewAction } from './opsReviews';

// Behaviours under test:
// - the caller is checked first: a caller sent away changes nothing
// - a refused form redirects with the invalid notice and changes nothing
// - a hide passes the id and reason, an unhide the id, to the data layer with the ops caller
// - a hide or show that changed the review refreshes its experience's tag, then redirects with the outcome
// - an outcome that changed nothing redirects with its notice and asks for no refresh

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const experienceId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const path = '/ops/reviews';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe.each([
  ['hideReviewAction', hideReviewAction, { id, reason: 'spam' }],
  ['unhideReviewAction', unhideReviewAction, { id }],
])('%s', (_name, action, fields) => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected(path));
    await expect(action(form(fields))).rejects.toMatchObject({ href: path });
    expect(mocks.setReviewVisibility).not.toHaveBeenCalled();
  });

  it('redirects with the invalid notice for a form with no id', async () => {
    await expect(action(form({ reason: 'spam' }))).rejects.toMatchObject({
      href: `${path}?notice=invalid`,
    });
    expect(mocks.setReviewVisibility).not.toHaveBeenCalled();
  });
});

describe('hideReviewAction', () => {
  it('redirects with the invalid notice for a missing or unknown reason', async () => {
    for (const fields of [{ id }, { id, reason: 'because' }]) {
      await expect(hideReviewAction(form(fields))).rejects.toMatchObject({
        href: `${path}?notice=invalid`,
      });
    }
    expect(mocks.setReviewVisibility).not.toHaveBeenCalled();
  });

  it('hides, refreshes the experience, and redirects with the outcome', async () => {
    mocks.setReviewVisibility.mockResolvedValue({
      outcome: 'hidden',
      experienceId,
    });
    await expect(
      hideReviewAction(form({ id, reason: 'spam' })),
    ).rejects.toMatchObject({ href: `${path}?notice=hidden` });
    expect(mocks.setReviewVisibility).toHaveBeenCalledWith(ops, {
      action: 'hide',
      id,
      reason: 'spam',
    });
    expect(mocks.updateTagsForChanges).toHaveBeenCalledWith([
      { kind: 'experience', experienceId },
    ]);
  });
});

describe('unhideReviewAction', () => {
  it('shows again, refreshes the experience, and redirects with the outcome', async () => {
    mocks.setReviewVisibility.mockResolvedValue({
      outcome: 'unhidden',
      experienceId,
    });
    await expect(unhideReviewAction(form({ id }))).rejects.toMatchObject({
      href: `${path}?notice=unhidden`,
    });
    expect(mocks.setReviewVisibility).toHaveBeenCalledWith(ops, {
      action: 'unhide',
      id,
    });
    expect(mocks.updateTagsForChanges).toHaveBeenCalledWith([
      { kind: 'experience', experienceId },
    ]);
  });

  it.each([
    ['already_visible', experienceId],
    ['not_found', null],
  ])('redirects with %s and refreshes no page', async (outcome, found) => {
    mocks.setReviewVisibility.mockResolvedValue({
      outcome,
      experienceId: found,
    });
    await expect(unhideReviewAction(form({ id }))).rejects.toMatchObject({
      href: `${path}?notice=${outcome}`,
    });
    expect(mocks.updateTagsForChanges).toHaveBeenCalledWith([]);
  });
});
