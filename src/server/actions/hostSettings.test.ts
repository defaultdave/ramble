import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  getCaller: vi.fn(),
  updateHostSettings: vi.fn(),
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
vi.mock('@/server/auth/caller', () => ({ getCaller: mocks.getCaller }));
vi.mock('@/server/db/hostSettings', () => ({
  updateHostSettings: mocks.updateHostSettings,
}));

import { updateHostSettingsAction } from './hostSettings';

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in goes to sign in and back, and nothing is saved
// - a signed-in person who owns no host goes back to the page, which refuses them, and nothing is saved
// - the host saved is the one the caller's grant names, never a posted host id
// - a refused form returns with the fields to look at and saves nothing
// - a save, and a form with nothing different, each return with their notice
// - a host that is gone returns to the page with no notice

const owner = {
  userId: id(1),
  roles: ['host_owner'],
  hostIds: [id(2)],
  hostGrants: [{ role: 'host_owner', hostId: id(2) }],
};

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

const valid = { name: 'Spoke', description: '', notificationEmail: '' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCaller.mockResolvedValue(owner);
});

describe('updateHostSettingsAction', () => {
  it('sends nobody signed in to sign in and back', async () => {
    mocks.getCaller.mockResolvedValue({ userId: null, roles: [], hostIds: [] });
    const href = await redirectOf(() =>
      updateHostSettingsAction(formOf(valid)),
    );
    expect(href).toBe('/sign-in?next=%2Fhost%2Fsettings');
    expect(mocks.updateHostSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['a guest', { roles: ['guest'], hostIds: [], hostGrants: [] }],
    [
      'host staff, who change nothing',
      {
        roles: ['host_staff'],
        hostIds: [id(2)],
        hostGrants: [{ role: 'host_staff', hostId: id(2) }],
      },
    ],
  ])('sends %s back to the page and saves nothing', async (_who, caller) => {
    mocks.getCaller.mockResolvedValue({ userId: id(3), ...caller });
    const href = await redirectOf(() =>
      updateHostSettingsAction(formOf(valid)),
    );
    expect(href).toBe('/host/settings');
    expect(mocks.updateHostSettings).not.toHaveBeenCalled();
  });

  it('saves the host the grant names and ignores a posted host id', async () => {
    mocks.updateHostSettings.mockResolvedValue('updated');
    const href = await redirectOf(() =>
      updateHostSettingsAction(formOf({ ...valid, hostId: id(9) })),
    );
    expect(mocks.updateHostSettings).toHaveBeenCalledWith(owner, id(2), {
      name: 'Spoke',
      description: null,
      notificationEmail: null,
    });
    expect(href).toBe('/host/settings?notice=updated');
  });

  it('returns a refused form with its fields and saves nothing', async () => {
    const href = await redirectOf(() =>
      updateHostSettingsAction(
        formOf({ name: '', description: '', notificationEmail: 'nope' }),
      ),
    );
    expect(href).toBe(
      '/host/settings?notice=invalid&fields=name%2CnotificationEmail',
    );
    expect(mocks.updateHostSettings).not.toHaveBeenCalled();
  });

  it('says when nothing was different', async () => {
    mocks.updateHostSettings.mockResolvedValue('unchanged');
    const href = await redirectOf(() =>
      updateHostSettingsAction(formOf(valid)),
    );
    expect(href).toBe('/host/settings?notice=unchanged');
  });

  it('returns to the page with no notice for a host that is gone', async () => {
    mocks.updateHostSettings.mockResolvedValue('not_found');
    const href = await redirectOf(() =>
      updateHostSettingsAction(formOf(valid)),
    );
    expect(href).toBe('/host/settings');
  });
});
