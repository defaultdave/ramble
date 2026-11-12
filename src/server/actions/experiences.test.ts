import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  createExperience: vi.fn(),
  updateExperience: vi.fn(),
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
vi.mock('@/server/db/experienceEditor', () => ({
  createExperience: mocks.createExperience,
  updateExperience: mocks.updateExperience,
}));

import { createExperienceAction, updateExperienceAction } from './experiences';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role is sent to the list and nothing is read, parsed or written
// - a form that fails parsing goes back to its page naming the fields, and writes nothing
// - a create that is made goes to the new experience; one with a stale choice goes back to the form
// - an update goes back to the experience with the notice for its result; a missing experience goes to the list
// - an update the data layer refuses goes back naming the fields
// - an experience id that is not an id goes to the list and writes nothing

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };
const valid = {
  hostId: id(2),
  name: 'Wheel night',
  slug: 'wheel-night',
  categoryId: id(3),
  neighborhoodId: id(4),
  cancellationTierId: id(5),
  ageRule: 'all_ages',
  taxTreatment: 'unknown',
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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readOpsCaller.mockResolvedValue(ops);
});

describe.each([
  ['create', createExperienceAction, valid],
  ['update', updateExperienceAction, { ...valid, experienceId: id(9) }],
])('the %s action without the ops role', (_name, action, fields) => {
  it.each([
    ['an admin', { userId: id(1), roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the list and writes nothing', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    const href = await redirectOf(() => action(formOf(fields)));

    expect(href).toBe('/ops/experiences');
    expect(mocks.createExperience).not.toHaveBeenCalled();
    expect(mocks.updateExperience).not.toHaveBeenCalled();
  });
});

describe('createExperienceAction', () => {
  it('goes back to the form naming the fields of a form that fails', async () => {
    const href = await redirectOf(() =>
      createExperienceAction(formOf({ ...valid, name: '', categoryId: '' })),
    );

    expect(href).toBe(
      '/ops/experiences/new?notice=invalid&fields=name%2CcategoryId',
    );
    expect(mocks.createExperience).not.toHaveBeenCalled();
  });

  it('goes to the new experience once it is made, with the ops caller and the parsed form', async () => {
    mocks.createExperience.mockResolvedValue({
      status: 'created',
      experienceId: id(7),
    });

    const href = await redirectOf(() => createExperienceAction(formOf(valid)));

    expect(href).toBe(`/ops/experiences/${id(7)}?notice=created`);
    expect(mocks.createExperience).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({ hostId: id(2), name: 'Wheel night' }),
    );
  });

  it('goes back to the form when a choice is no longer there', async () => {
    mocks.createExperience.mockResolvedValue({ status: 'reference_missing' });

    const href = await redirectOf(() => createExperienceAction(formOf(valid)));

    expect(href).toBe('/ops/experiences/new?notice=reference_missing');
  });
});

describe('updateExperienceAction', () => {
  const edit = { ...valid, experienceId: id(9) };
  const here = `/ops/experiences/${id(9)}`;

  it('sends an id that is not an id to the list and writes nothing', async () => {
    const href = await redirectOf(() =>
      updateExperienceAction(formOf({ ...edit, experienceId: 'nope' })),
    );

    expect(href).toBe('/ops/experiences');
    expect(mocks.updateExperience).not.toHaveBeenCalled();
  });

  it('goes back to the experience naming the fields of a form that fails', async () => {
    const href = await redirectOf(() =>
      updateExperienceAction(formOf({ ...edit, slug: '' })),
    );

    expect(href).toBe(`${here}?notice=invalid&fields=slug`);
    expect(mocks.updateExperience).not.toHaveBeenCalled();
  });

  it.each(['updated', 'unchanged', 'reference_missing'])(
    'goes back to the experience with the %s notice',
    async (status) => {
      mocks.updateExperience.mockResolvedValue({ status });

      const href = await redirectOf(() => updateExperienceAction(formOf(edit)));

      expect(href).toBe(`${here}?notice=${status}`);
      expect(mocks.updateExperience).toHaveBeenCalledWith(
        ops,
        id(9),
        expect.objectContaining({ slug: 'wheel-night' }),
      );
    },
  );

  it('sends a missing experience to the list', async () => {
    mocks.updateExperience.mockResolvedValue({ status: 'not_found' });

    const href = await redirectOf(() => updateExperienceAction(formOf(edit)));

    expect(href).toBe('/ops/experiences');
  });

  it('goes back naming the fields the data layer refused', async () => {
    mocks.updateExperience.mockResolvedValue({
      status: 'invalid',
      fields: ['linkOutUrl', 'adultPrice'],
    });

    const href = await redirectOf(() => updateExperienceAction(formOf(edit)));

    expect(href).toBe(`${here}?notice=invalid&fields=linkOutUrl%2CadultPrice`);
  });
});
