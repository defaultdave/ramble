import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coverLookupIds } from '@/lib/photoViews';
import type { GuestPhoto } from '@/lib/photos';
import { readGuestCovers } from './guestCovers';

// Behaviours under test, one per decision, branch or risk:
// - the covers come back keyed by experience, lowest position first
// - the lookup gets the lookup IDs (lower-case, each once, sorted) and not the list as it came in
// - an empty list gives an empty map
// - a failed read that rethrowOrLog lets pass gives an empty map and is logged under the caller's message
// - a failed read that rethrowOrLog rethrows (the end of a prerender) reaches the caller

const covers = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/server/coverPhotos', () => ({ getCoverPhotos: covers.read }));

const monitoring = vi.hoisted(() => ({ rethrowOrLog: vi.fn() }));
vi.mock('@/server/monitoring/rethrowOrLog', () => monitoring);

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const photo = (experienceId: string, position: number): GuestPhoto => ({
  id: id(100 + position),
  experienceId,
  position,
  url: `https://store.example/public/photos/${experienceId}/${String(position)}.jpg`,
  width: 1600,
  height: 1000,
  decorative: false,
  altText: `Photo ${String(position)}`,
  blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
});

beforeEach(() => {
  vi.clearAllMocks();
  covers.read.mockResolvedValue([]);
});

describe('readGuestCovers', () => {
  it('maps each experience to its cover, the photo with the lowest position', async () => {
    covers.read.mockResolvedValue([
      photo(id(1), 2),
      photo(id(1), 0),
      photo(id(2), 1),
    ]);

    const result = await readGuestCovers('home covers', [id(1), id(2)]);

    expect([...result.keys()]).toEqual([id(1), id(2)]);
    expect(result.get(id(1))?.src).toContain(`/${id(1)}/0.jpg`);
    expect(result.get(id(2))?.src).toContain(`/${id(2)}/1.jpg`);
  });

  it('asks for the lookup IDs, not the list it was given', async () => {
    const given = [id(2).toUpperCase(), id(1), id(2)];

    await readGuestCovers('home covers', given);

    expect(covers.read).toHaveBeenCalledExactlyOnceWith(coverLookupIds(given));
    expect(covers.read).toHaveBeenCalledExactlyOnceWith([id(1), id(2)]);
  });

  it('gives an empty map for an empty list', async () => {
    const result = await readGuestCovers('home covers', []);

    expect(result).toEqual(new Map());
    expect(covers.read).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('gives an empty map and logs under the message when the read fails and the error is not rethrown', async () => {
    const failure = new Error('read failed');
    covers.read.mockRejectedValue(failure);

    const result = await readGuestCovers('home covers', [id(1)]);

    expect(result).toEqual(new Map());
    expect(monitoring.rethrowOrLog).toHaveBeenCalledExactlyOnceWith(
      'home covers',
      failure,
    );
  });

  it('lets an error that rethrowOrLog rethrows reach the caller', async () => {
    const prerenderEnd = new Error('prerender is complete');
    covers.read.mockRejectedValue(prerenderEnd);
    monitoring.rethrowOrLog.mockImplementation(() => {
      throw prerenderEnd;
    });

    await expect(readGuestCovers('home covers', [id(1)])).rejects.toBe(
      prerenderEnd,
    );
  });
});
