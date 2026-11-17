import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  getCaller: vi.fn(),
  readStaff: vi.fn(),
  readBookings: vi.fn(),
  readGuestList: vi.fn(),
  readWeek: vi.fn(),
  buildWeek: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/caller', () => ({ getCaller: mocks.getCaller }));
vi.mock('@/server/db/staffRoles', () => ({ readHostStaff: mocks.readStaff }));
vi.mock('@/server/db/hostGuestLists', () => ({
  readHostBookings: mocks.readBookings,
  readHostGuestList: mocks.readGuestList,
}));
vi.mock('@/server/db/sessions', () => ({ readHostWeek: mocks.readWeek }));
vi.mock('@/lib/hostSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/hostSessions')>()),
  buildHostWeek: mocks.buildWeek,
}));

import { loadHostBookings, loadHostGuestList } from './hostGuestLists';
import { loadHostWeek } from './hostSessions';
import { loadHostStaff } from './hostStaff';

// Behaviours under test, one per decision, branch or risk, for the four host loaders that go
// through `loadForHostArea` (the access gate itself is tested in hostArea.test.ts):
// - nobody signed in is sent to sign in, and nothing is read
// - a signed-in caller with no host role is refused, and nothing is read
// - a read that finds no row (missing host, another host's row, a bad session id) is refused as the same result
// - host staff are refused by the staff page without a read, and read by the week, bookings and guest list
// - an owner gets the page's result, from a read for their own host
// - the week is built for staff as read-only and for an owner as editable

const caller = (hostGrants: { role: string; hostId: string }[]) => ({
  userId: id(1),
  roles: [],
  hostIds: [],
  hostGrants,
});
const signedOut = { userId: null, roles: [], hostIds: [] };
const guest = caller([]);
const owner = caller([{ role: 'host_owner', hostId: id(2) }]);
const staff = caller([{ role: 'host_staff', hostId: id(2) }]);

const sessionId = id(7);
const loaders = {
  staff: { run: () => loadHostStaff(), read: mocks.readStaff },
  bookings: { run: () => loadHostBookings('ada'), read: mocks.readBookings },
  guestList: {
    run: () => loadHostGuestList(sessionId),
    read: mocks.readGuestList,
  },
  week: { run: () => loadHostWeek('2026-11-16'), read: mocks.readWeek },
} as const;
type Name = keyof typeof loaders;
const names = Object.keys(loaders) as Name[];
const staffMayRead = names.filter((name) => name !== 'staff');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readStaff.mockResolvedValue([]);
  mocks.readBookings.mockResolvedValue({ bookings: [] });
  mocks.readGuestList.mockResolvedValue({
    scope: 'owner',
    session: {
      hostName: 'Harbor Kayak Co',
      id: sessionId,
      experienceName: 'Sunset kayak',
      startsAt: new Date('2026-11-14T21:00:00Z'),
      timeZone: 'America/New_York',
      waiverRequired: false,
    },
    bookings: [],
  });
  mocks.readWeek.mockResolvedValue({ week: 'data' });
  mocks.buildWeek.mockReturnValue({ week: 'view' });
});

describe.each(names)('%s loader', (name) => {
  const { run, read } = loaders[name];

  it('sends nobody signed in to sign in, reading nothing', async () => {
    mocks.getCaller.mockResolvedValue(signedOut);
    expect(await run()).toEqual({ status: 'signed_out' });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a caller with no host role, reading nothing', async () => {
    mocks.getCaller.mockResolvedValue(guest);
    expect(await run()).toEqual({ status: 'refused' });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses an owner whose read finds no row (a missing host, or another host’s row)', async () => {
    mocks.getCaller.mockResolvedValue(owner);
    read.mockResolvedValue(null);
    expect(await run()).toEqual({ status: 'refused' });
  });

  it('gives an owner the page, from a read for their own host', async () => {
    mocks.getCaller.mockResolvedValue(owner);
    expect(await run()).toMatchObject({ status: 'ok' });
    expect(read).toHaveBeenCalledWith(owner, id(2), ...extraArgs(name));
  });
});

describe.each(staffMayRead)('%s loader, for host staff', (name) => {
  it('reads their host and gives them the page', async () => {
    mocks.getCaller.mockResolvedValue(staff);
    expect(await loaders[name].run()).toMatchObject({ status: 'ok' });
    expect(loaders[name].read).toHaveBeenCalledWith(
      staff,
      id(2),
      ...extraArgs(name),
    );
  });
});

describe('staff loader, for host staff', () => {
  it('refuses them without a read, as it refuses a guest', async () => {
    mocks.getCaller.mockResolvedValue(staff);
    expect(await loadHostStaff()).toEqual({ status: 'refused' });
    expect(mocks.readStaff).not.toHaveBeenCalled();
  });
});

describe('guest list loader, for a session id that is no id', () => {
  it.each([
    ['an owner', owner],
    ['host staff', staff],
  ])('refuses %s without a read', async (_who, who) => {
    mocks.getCaller.mockResolvedValue(who);
    expect(await loadHostGuestList('not-an-id')).toEqual({
      status: 'refused',
    });
    expect(mocks.readGuestList).not.toHaveBeenCalled();
  });
});

describe('week loader', () => {
  it.each([
    ['an owner', owner, true],
    ['host staff', staff, false],
  ])('builds the week for %s with canEdit %s', async (_who, who, canEdit) => {
    mocks.getCaller.mockResolvedValue(who);
    expect(await loadHostWeek(undefined)).toEqual({
      status: 'ok',
      view: { week: 'view' },
    });
    expect(mocks.buildWeek).toHaveBeenCalledWith(
      { week: 'data' },
      expect.any(Date),
      canEdit,
    );
  });
});

function extraArgs(name: Name): unknown[] {
  if (name === 'bookings') return ['ada'];
  if (name === 'guestList') return [sessionId];
  if (name === 'week') return ['2026-11-16', expect.any(Date)];
  return [];
}
