import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../tests/support/ids';
import { makeDriverError } from '../../tests/support/driverError';
import { getHostPage } from './hostPage';

// Behaviours under test, one per decision, branch or risk:
// - a string that is no slug gives null before anything is tagged or read
// - an unknown host gives null, is not kept (the uncached profile), and reads no cards
// - a host comes back with the cards read for their live experiences, with covers, and each one's tier
// - the entry uses the catalog profile and is tagged with `catalog` and each experience listed
// - a host with nothing live reads no cards
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheLife: cache.life, cacheTag: cache.tag }));

const db = vi.hoisted(() => ({ listing: vi.fn(), cards: vi.fn() }));
vi.mock('@/server/db/hosts', () => ({ getHostListing: db.listing }));
vi.mock('@/server/db/home', () => ({ listHomeExperiences: db.cards }));

const driverError = makeDriverError('secret-id');
const tier = {
  id: id(5),
  key: 'flexible',
  name: 'Flexible',
  fullRefundHoursBefore: 24,
  isDefault: true,
};
const host = {
  id: id(2),
  slug: 'hudson-paddle-club',
  name: 'Hudson Paddle Club',
  description: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listing.mockResolvedValue({
    host,
    live: [
      { id: id(1), cancellationTier: tier },
      { id: id(7), cancellationTier: tier },
    ],
  });
  db.cards.mockResolvedValue([{ id: id(1) }, { id: id(7) }]);
});

describe('getHostPage', () => {
  it.each(['', 'Not_A_Slug', 'not_a_slug', '-x', 'x'.repeat(301)])(
    'gives null for %j, and tags and reads nothing',
    async (bad) => {
      expect(await getHostPage(bad)).toBeNull();
      expect(cache.tag).not.toHaveBeenCalled();
      expect(db.listing).not.toHaveBeenCalled();
    },
  );

  it('comes back with the host, the cards of their live experiences with covers, and each tier', async () => {
    const page = await getHostPage('hudson-paddle-club');

    expect(db.listing).toHaveBeenCalledExactlyOnceWith('hudson-paddle-club');
    expect(db.cards).toHaveBeenCalledExactlyOnceWith([id(1), id(7)], {
      covers: true,
    });
    expect(page).toEqual({
      host,
      experiences: [{ id: id(1) }, { id: id(7) }],
      tiers: [
        { experienceId: id(1), tier },
        { experienceId: id(7), tier },
      ],
    });
  });

  it('uses the catalog profile and tags the catalog and each experience listed', async () => {
    await getHostPage('hudson-paddle-club');

    expect(cache.life).toHaveBeenCalledWith('catalog');
    expect(cache.life).not.toHaveBeenCalledWith('uncached');
    expect(cache.tag.mock.calls.flat().toSorted()).toEqual(
      ['catalog', `experience:${id(1)}`, `experience:${id(7)}`].toSorted(),
    );
  });

  it('keeps nothing for an unknown host, and reads no cards', async () => {
    db.listing.mockResolvedValue(null);

    expect(await getHostPage('nobody')).toBeNull();
    expect(cache.life).toHaveBeenLastCalledWith('uncached');
    expect(db.cards).not.toHaveBeenCalled();
  });

  it('reads no cards for a host with nothing live', async () => {
    db.listing.mockResolvedValue({ host, live: [] });

    expect(await getHostPage('hudson-paddle-club')).toEqual({
      host,
      experiences: [],
      tiers: [],
    });
    expect(db.cards).not.toHaveBeenCalled();
  });

  it.each([
    ['the host', () => db.listing.mockRejectedValue(driverError), 'Host page'],
    [
      'the cards',
      () => db.cards.mockRejectedValue(driverError),
      'Host experiences',
    ],
  ])(
    'throws only the kind of a failed read of %s',
    async (_name, fail, read) => {
      fail();

      const failure = await getHostPage('hudson-paddle-club').catch(
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ message: `${read} read failed: Error` });
      expect(JSON.stringify(failure)).not.toContain('secret-id');
    },
  );
});
