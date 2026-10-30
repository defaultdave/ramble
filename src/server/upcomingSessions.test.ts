import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingRead, upcomingSessionLimits } from '@/lib/upcomingSessions';
import { readUpcomingSessions } from './upcomingSessions';

// Behaviours under test, one per decision, branch or risk:
// - the list uses the browse profile and tags the experience, in lower case
// - the list reads the window of its minute key, as long as the window bound, and six sessions
// - the booking read passes its own limit and window on, and a read outside the bounds throws before anything is read
// - an ID that is no guid reads nothing, is not tagged, and is not kept
// - each listed session is paired with its own spaces left, in the order listed, a null where none is visible
// - a failed list read throws only the kind of the failure, never the query or its values
// - a failed spaces read reaches the caller, so the page shows its error state rather than a list missing a date

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheLife: cache.life, cacheTag: cache.tag }));

const db = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/server/db/upcomingSessions', () => ({
  listUpcomingSessions: db.list,
}));

const spaces = vi.hoisted(() => ({ left: vi.fn() }));
vi.mock('@/server/spacesLeft', () => ({ getSpacesLeft: spaces.left }));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asOf = '2026-11-02T15:00:00.000Z';
const session = (n: number) => ({
  id: id(n),
  startsAt: new Date('2026-11-07T22:30:00Z'),
  timeZone: 'America/New_York',
});

beforeEach(() => {
  vi.clearAllMocks();
  db.list.mockResolvedValue([session(1), session(2), session(3)]);
  spaces.left.mockImplementation((sessionId: string) =>
    Promise.resolve(sessionId === id(2) ? 0 : sessionId === id(3) ? null : 5),
  );
});

describe('readUpcomingSessions', () => {
  it('reads on the browse profile under the experience tag, in lower case', async () => {
    await readUpcomingSessions(id(9).toUpperCase(), asOf);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('browse');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(`experience:${id(9)}`);
  });

  it('reads the window that opens at the key and runs the bound', async () => {
    await readUpcomingSessions(id(9), asOf);

    const [lookedUp, window, limit] = db.list.mock.calls[0] as [
      string,
      { from: Date; to: Date },
      number,
    ];
    expect(limit).toBe(upcomingSessionLimits.maxRows);
    expect(lookedUp).toBe(id(9));
    expect(window.from.toISOString()).toBe(asOf);
    expect(window.to.getTime() - window.from.getTime()).toBe(
      upcomingSessionLimits.windowDays * 86_400_000,
    );
  });

  it('reads the booking window and its limit when the choices ask for them', async () => {
    await readUpcomingSessions(id(9), asOf, bookingRead);

    const [, window, limit] = db.list.mock.calls[0] as [
      string,
      { from: Date; to: Date },
      number,
    ];
    expect(limit).toBe(60);
    expect(window.to.getTime() - window.from.getTime()).toBe(60 * 86_400_000);
  });

  it.each([
    { limit: 61, windowDays: 60 },
    { limit: 0, windowDays: 60 },
    { limit: 60, windowDays: 91 },
  ])('refuses the read %j before reading anything', async (reading) => {
    await expect(
      readUpcomingSessions(id(9), asOf, reading),
    ).rejects.toBeInstanceOf(RangeError);
    expect(db.list).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-guid', `${id(9)}0`])(
    'reads nothing for the ID %j and keeps nothing',
    async (experienceId) => {
      await expect(readUpcomingSessions(experienceId, asOf)).resolves.toEqual(
        [],
      );

      expect(db.list).not.toHaveBeenCalled();
      expect(cache.tag).not.toHaveBeenCalled();
      expect(cache.life).toHaveBeenLastCalledWith('uncached');
    },
  );

  it('pairs each session with its own spaces, in the order listed', async () => {
    const found = await readUpcomingSessions(id(9), asOf);

    expect(
      found.map(({ session: s, spacesLeft }) => [s.id, spacesLeft]),
    ).toEqual([
      [id(1), 5],
      [id(2), 0],
      [id(3), null],
    ]);
  });

  it('is an empty list when the experience has no upcoming session, and reads no spaces', async () => {
    db.list.mockResolvedValue([]);

    await expect(readUpcomingSessions(id(9), asOf)).resolves.toEqual([]);
    expect(spaces.left).not.toHaveBeenCalled();
  });

  it('throws the kind of a failed list read and nothing of the query', async () => {
    db.list.mockRejectedValue(
      new Error('Failed query: select ... where id = $1\nparams: secret-id'),
    );

    const failure: unknown = await readUpcomingSessions(id(9), asOf).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Upcoming sessions read failed: Error',
    );
  });

  it('lets a failed spaces read reach the caller', async () => {
    spaces.left.mockRejectedValue(new Error('Spaces left read failed: Error'));

    await expect(readUpcomingSessions(id(9), asOf)).rejects.toThrow(
      'Spaces left read failed',
    );
  });
});
