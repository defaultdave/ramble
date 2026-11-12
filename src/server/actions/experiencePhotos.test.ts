import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  addPhoto: vi.fn(),
  storage: { name: 'storage' },
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
vi.mock('@/server/ports/storage/config', () => ({
  getStorage: () => mocks.storage,
}));
vi.mock('@/server/db/photos', () => ({
  addPhoto: mocks.addPhoto,
  ExperienceNotFoundError: class ExperienceNotFoundError extends Error {},
  PhotoLimitError: class PhotoLimitError extends Error {},
}));

import { ExperienceNotFoundError, PhotoLimitError } from '@/server/db/photos';
import { PhotoRefusedError } from '@/server/photos/ingest';
import { addExperiencePhotoAction } from './experiencePhotos';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role is sent to the list and nothing is parsed, read or stored
// - an experience id that is not an id goes to the list
// - a form that fails parsing goes back naming the fields, and stores nothing
// - a file over the upload limit goes back on the file field without its bytes being read
// - a good form adds the photo as the ops caller, with the parsed input, the file's bytes and the storage port
// - a photo added goes back with the added notice
// - each refusal of the pipeline goes back on the file field with its own notice
// - a full gallery goes back with the limit notice; a missing experience goes to the list
// - any other failure is not swallowed

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };
const here = `/ops/experiences/${id(9)}`;
const bytes = new Uint8Array([1, 2, 3]);

function formOf(overrides: Record<string, string | Blob> = {}) {
  const data = new FormData();
  const fields = {
    experienceId: id(9),
    photoFile: new File([bytes], 'bowl.jpg', { type: 'image/jpeg' }),
    altText: 'A potter shaping a bowl',
    rightsBasis: 'ramble_owned',
    ...overrides,
  };
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

describe('addExperiencePhotoAction', () => {
  it.each([
    ['an admin', { userId: id(1), roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the list and stores nothing', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    const href = await redirectOf(() => addExperiencePhotoAction(formOf()));

    expect(href).toBe('/ops/experiences');
    expect(mocks.addPhoto).not.toHaveBeenCalled();
  });

  it('sends an id that is not an id to the list', async () => {
    const href = await redirectOf(() =>
      addExperiencePhotoAction(formOf({ experienceId: 'nope' })),
    );

    expect(href).toBe('/ops/experiences');
    expect(mocks.addPhoto).not.toHaveBeenCalled();
  });

  it('goes back naming the fields of a form that fails', async () => {
    const href = await redirectOf(() =>
      addExperiencePhotoAction(formOf({ altText: '', photoFile: '' })),
    );

    expect(href).toBe(
      `${here}?notice=photo_invalid&fields=photoFile%2CaltText`,
    );
    expect(mocks.addPhoto).not.toHaveBeenCalled();
  });

  it('goes back on the file field for a file over the limit, without reading it', async () => {
    const big = new File([], 'big.jpg');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const read = vi.spyOn(big, 'arrayBuffer');

    const href = await redirectOf(() =>
      addExperiencePhotoAction(formOf({ photoFile: big })),
    );

    expect(href).toBe(`${here}?notice=photo_too_large&fields=photoFile`);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.addPhoto).not.toHaveBeenCalled();
  });

  it('adds the photo as the ops caller with the parsed input, the bytes and the storage port', async () => {
    mocks.addPhoto.mockResolvedValue({});

    const href = await redirectOf(() => addExperiencePhotoAction(formOf()));

    expect(href).toBe(`${here}?notice=photo_added`);
    expect(mocks.addPhoto).toHaveBeenCalledWith(
      ops,
      {
        experienceId: id(9),
        description: { decorative: false, altText: 'A potter shaping a bowl' },
        rights: {
          basis: 'ramble_owned',
          holder: null,
          license: null,
          sourceUrl: null,
        },
      },
      bytes,
      mocks.storage,
    );
  });

  it.each([
    ['too_large', 'photo_too_large'],
    ['unsupported_format', 'photo_unsupported_format'],
    ['too_many_pixels', 'photo_too_many_pixels'],
    ['too_small', 'photo_too_small'],
    ['animated', 'photo_animated'],
    ['corrupt', 'photo_corrupt'],
  ] as const)(
    'goes back on the file field when the pipeline refuses the photo as %s',
    async (code, notice) => {
      mocks.addPhoto.mockRejectedValue(new PhotoRefusedError(code));

      const href = await redirectOf(() => addExperiencePhotoAction(formOf()));

      expect(href).toBe(`${here}?notice=${notice}&fields=photoFile`);
    },
  );

  it('goes back with the limit notice for a full gallery', async () => {
    mocks.addPhoto.mockRejectedValue(new PhotoLimitError());

    const href = await redirectOf(() => addExperiencePhotoAction(formOf()));

    expect(href).toBe(`${here}?notice=photo_limit`);
  });

  it('sends a missing experience to the list', async () => {
    mocks.addPhoto.mockRejectedValue(new ExperienceNotFoundError());

    const href = await redirectOf(() => addExperiencePhotoAction(formOf()));

    expect(href).toBe('/ops/experiences');
  });

  it('does not swallow a failure it does not know', async () => {
    mocks.addPhoto.mockRejectedValue(new Error('the store is down'));

    await expect(addExperiencePhotoAction(formOf())).rejects.toThrow(
      'the store is down',
    );
  });
});
