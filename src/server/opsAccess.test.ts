import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readOpsCaller: vi.fn() }));

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
vi.mock('./opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));

import { idOrLeave, opsCallerOrLeave } from './opsAccess';

// Behaviours under test:
// - the ops caller is returned as read
// - anyone else, admin included, is sent to the page it is given, and nothing is returned
// - a form naming an id in the asked field gives it lower-cased; one naming none goes to the page it is given

beforeEach(() => {
  vi.resetAllMocks();
});

describe('opsCallerOrLeave', () => {
  it('returns the ops caller', async () => {
    const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
    mocks.readOpsCaller.mockResolvedValue(ops);

    await expect(opsCallerOrLeave('/ops/x')).resolves.toBe(ops);
  });

  it.each([
    ['an admin', { userId: 'u', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the page it is given', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    await expect(opsCallerOrLeave('/ops/x')).rejects.toMatchObject({
      href: '/ops/x',
    });
  });
});

describe('idOrLeave', () => {
  const formWith = (value: string | null) => {
    const data = new FormData();
    if (value !== null) data.set('experienceId', value);
    return data;
  };

  it('returns the id the form names, lower-cased', () => {
    expect(
      idOrLeave(
        formWith('0A1B2C3D-4B5A-4697-8A9B-0C1D2E3F4A5B'),
        'experienceId',
        '/ops/x',
      ),
    ).toBe('0a1b2c3d-4b5a-4697-8a9b-0c1d2e3f4a5b');
  });

  it.each([
    ['nothing', null],
    ['text that is no id', 'nope'],
  ])('sends a form naming %s to the page it is given', (_name, value) => {
    expect(() => idOrLeave(formWith(value), 'experienceId', '/ops/x')).toThrow(
      expect.objectContaining({ href: '/ops/x' }),
    );
  });
});
