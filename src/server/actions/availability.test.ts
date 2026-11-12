import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  addWeeklySlots: vi.fn(),
  updateSlotSeats: vi.fn(),
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
vi.mock('@/server/db/availability', () => ({
  addWeeklySlots: mocks.addWeeklySlots,
  updateSlotSeats: mocks.updateSlotSeats,
}));

import { addWeeklySlotsAction, updateSlotSeatsAction } from './availability';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role is sent to the experiences list and nothing is written
// - an experience id that is not an id goes to the list and nothing is written
// - an add with a field to fix goes back to the page naming the fields and writes nothing
// - an add that goes through, a repeated slot and an unusable zone each go back with their notice
// - an add for an experience that is gone goes to the list
// - the days, time, length, seats and source posted are the ones passed on, for the experience the form names
// - a seats form with a bad number or no slot goes back with a notice and writes nothing
// - each seat result goes back to the page with its notice, and a slot that is gone says so

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };
const list = '/ops/experiences';
const here = `/ops/experiences/${id(9)}/availability`;

const addForm = {
  experienceId: id(9),
  weekday1: 'on',
  weekday6: 'on',
  startTime: '10:00',
  durationMinutes: '120',
  allocation: '8',
  source: 'ramble',
};
const seatsForm = { experienceId: id(9), templateId: id(5), allocation: '12' };

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
  ['add', addWeeklySlotsAction, addForm, mocks.addWeeklySlots],
  ['seats', updateSlotSeatsAction, seatsForm, mocks.updateSlotSeats],
])('the %s action', (_name, action, posted, write) => {
  it('sends a caller without the ops role to the list and writes nothing', async () => {
    mocks.readOpsCaller.mockResolvedValue({ ...ops, roles: ['guest'] });

    expect(await redirectOf(() => action(formOf(posted)))).toBe(list);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([['nope'], ['']])(
    'sends an experience id of %j to the list and writes nothing',
    async (experienceId) => {
      expect(
        await redirectOf(() => action(formOf({ ...posted, experienceId }))),
      ).toBe(list);
      expect(write).not.toHaveBeenCalled();
    },
  );
});

describe('the add action', () => {
  it('names the fields to fix and writes nothing', async () => {
    const noDays: Record<string, string> = { ...addForm };
    delete noDays.weekday1;
    delete noDays.weekday6;
    const href = await redirectOf(() =>
      addWeeklySlotsAction(formOf({ ...noDays, startTime: 'noon' })),
    );

    expect(href).toBe(`${here}?notice=invalid&fields=weekdays%2CstartTime`);
    expect(mocks.addWeeklySlots).not.toHaveBeenCalled();
  });

  it('passes on the slots the form asks for', async () => {
    mocks.addWeeklySlots.mockResolvedValue({ status: 'added' });

    await redirectOf(() => addWeeklySlotsAction(formOf(addForm)));

    expect(mocks.addWeeklySlots).toHaveBeenCalledWith(
      ops,
      {
        experienceId: id(9),
        weekdays: [1, 6],
        startTime: '10:00',
        durationMinutes: 120,
        allocation: 8,
        source: 'ramble',
      },
      expect.any(Date),
    );
  });

  it.each([
    ['added', `${here}?notice=added`],
    ['duplicate_slot', `${here}?notice=duplicate_slot`],
    ['invalid_time_zone', `${here}?notice=invalid_time_zone`],
    ['experience_not_found', list],
  ])('a result of %s goes to %s', async (status, expected) => {
    mocks.addWeeklySlots.mockResolvedValue({ status });

    expect(await redirectOf(() => addWeeklySlotsAction(formOf(addForm)))).toBe(
      expected,
    );
  });
});

describe('the seats action', () => {
  it.each([
    ['a number that is not one', { allocation: 'many' }],
    ['no slot', { templateId: '' }],
  ])(
    'goes back with a notice for %s and writes nothing',
    async (_label, change) => {
      const href = await redirectOf(() =>
        updateSlotSeatsAction(formOf({ ...seatsForm, ...change })),
      );

      expect(href).toBe(`${here}?notice=invalid`);
      expect(mocks.updateSlotSeats).not.toHaveBeenCalled();
    },
  );

  it('passes on the slot and its new seats', async () => {
    mocks.updateSlotSeats.mockResolvedValue({ status: 'saved' });

    await redirectOf(() => updateSlotSeatsAction(formOf(seatsForm)));

    expect(mocks.updateSlotSeats).toHaveBeenCalledWith(
      ops,
      { templateId: id(5), allocation: 12 },
      expect.any(Date),
    );
  });

  it.each([
    ['saved', 'seats_saved'],
    ['unchanged', 'seats_unchanged'],
    ['below_sold_and_held', 'below_sold_and_held'],
    ['template_not_found', 'slot_gone'],
  ])('a result of %s shows the %s notice', async (status, notice) => {
    mocks.updateSlotSeats.mockResolvedValue({ status });

    expect(
      await redirectOf(() => updateSlotSeatsAction(formOf(seatsForm))),
    ).toBe(`${here}?notice=${notice}`);
  });
});
