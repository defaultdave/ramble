import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import { parseAuditEntry } from './audit';
import {
  availabilityPath,
  buildAvailabilityView,
  parseAddSlotsForm,
  parseSeatsForm,
  seatsMaxLength,
  slotsIntro,
  startTimeHint,
  weekdayFieldName,
  type AvailabilitySlot,
} from './availability';
import { slotAddedEntry, slotSeatsChangedEntry } from './experienceAudit';

// Behaviours under test, one per decision, branch or risk:
// - the availability page sits under the experience's own page
// - the add form reads one slot per ticked day, Monday first, with the form's time, length, seats and source
// - every field the schema refuses is named, in the form's order, and a form with no day names the days
// - a field typed past the limits or in the wrong shape is refused rather than coerced
// - the seats form needs a slot id and a whole number of seats in range
// - the slots read Monday first (Sunday last), then by start time, with their labels and how far ahead they are open
// - the audit rows for a slot and for its seats pass the audit log's own rules

const experienceId = id(1);

function form(fields: Record<string, unknown>) {
  return (name: string) => fields[name] ?? null;
}

const posted = {
  [weekdayFieldName(6)]: 'on',
  [weekdayFieldName(1)]: 'on',
  startTime: '10:00',
  durationMinutes: '120',
  allocation: '8',
  source: 'allocation',
};

describe('availabilityPath', () => {
  it('sits under the experience page', () => {
    expect(availabilityPath(experienceId)).toBe(
      `/ops/experiences/${experienceId}/availability`,
    );
  });
});

describe('parseAddSlotsForm', () => {
  it('reads a slot per ticked day, Monday first', () => {
    expect(parseAddSlotsForm(form(posted), experienceId)).toEqual({
      status: 'ready',
      input: {
        experienceId,
        weekdays: [1, 6],
        startTime: '10:00',
        durationMinutes: 120,
        allocation: 8,
        source: 'allocation',
      },
    });
  });

  it('takes Sunday, which is day 0', () => {
    const result = parseAddSlotsForm(
      form({
        ...posted,
        [weekdayFieldName(6)]: null,
        [weekdayFieldName(0)]: 'on',
      }),
      experienceId,
    );

    expect(result).toMatchObject({
      status: 'ready',
      input: { weekdays: [1, 0] },
    });
  });

  it.each([
    [
      'no day ticked',
      { [weekdayFieldName(1)]: null, [weekdayFieldName(6)]: null },
      ['weekdays'],
    ],
    ['a time that is not HH:MM', { startTime: '9am' }, ['startTime']],
    ['no time', { startTime: '' }, ['startTime']],
    ['a time past midnight', { startTime: '24:00' }, ['startTime']],
    ['a length of zero', { durationMinutes: '0' }, ['durationMinutes']],
    ['a length over a day', { durationMinutes: '1441' }, ['durationMinutes']],
    [
      'a length that is not a number',
      { durationMinutes: 'long' },
      ['durationMinutes'],
    ],
    ['seats over the limit', { allocation: '1001' }, ['allocation']],
    ['seats with a decimal', { allocation: '2.5' }, ['allocation']],
    ['no seats typed', { allocation: '' }, ['allocation']],
    ['no source', { source: '' }, ['source']],
    [
      'a source that is not a template source',
      { source: 'external' },
      ['source'],
    ],
    [
      'several at once, in the form’s order',
      {
        source: 'x',
        allocation: '-1',
        startTime: '',
        [weekdayFieldName(1)]: null,
        [weekdayFieldName(6)]: null,
      },
      ['weekdays', 'startTime', 'allocation', 'source'],
    ],
  ])('refuses %s', (_label, change, fields) => {
    expect(
      parseAddSlotsForm(form({ ...posted, ...change }), experienceId),
    ).toEqual({ status: 'invalid', fields });
  });

  it('allows zero seats, which stops a slot selling', () => {
    expect(
      parseAddSlotsForm(form({ ...posted, allocation: '0' }), experienceId)
        .status,
    ).toBe('ready');
  });
});

describe('parseSeatsForm', () => {
  it('reads the slot and its new seats', () => {
    expect(
      parseSeatsForm(form({ templateId: id(5), allocation: ' 12 ' })),
    ).toEqual({
      status: 'ready',
      input: { templateId: id(5), allocation: 12 },
    });
  });

  it.each([
    ['no slot', { allocation: '12' }],
    ['a slot that is not an id', { templateId: 'nope', allocation: '12' }],
    ['no seats', { templateId: id(5) }],
    ['seats over the limit', { templateId: id(5), allocation: '1001' }],
    ['seats that are not a number', { templateId: id(5), allocation: 'ten' }],
  ])('refuses %s', (_label, fields) => {
    expect(parseSeatsForm(form(fields))).toEqual({ status: 'invalid' });
  });
});

const slot = (overrides: Partial<AvailabilitySlot>): AvailabilitySlot => ({
  id: id(10),
  weekday: 1,
  startTime: '10:00:00',
  durationMinutes: 90,
  allocation: 8,
  source: 'ramble',
  upcoming: 12,
  lastDate: '2027-02-01',
  ...overrides,
});

describe('buildAvailabilityView', () => {
  const data = (slots: AvailabilitySlot[]) => ({
    experienceId,
    experienceName: 'Pottery',
    hostName: 'Clay Co',
    timeZone: 'America/New_York',
    slots,
  });

  it('puts Sunday last and orders a day by start time', () => {
    const view = buildAvailabilityView(
      data([
        slot({ id: id(1), weekday: 0 }),
        slot({ id: id(2), weekday: 6, startTime: '15:00:00' }),
        slot({ id: id(3), weekday: 6, startTime: '09:30:00' }),
        slot({ id: id(4), weekday: 1 }),
      ]),
    );

    expect(view.slots.map((row) => row.id)).toEqual([
      id(4),
      id(3),
      id(2),
      id(1),
    ]);
  });

  it('labels a slot and says how far ahead it is open', () => {
    const [row] = buildAvailabilityView(data([slot({})])).slots;

    expect(row).toEqual({
      id: id(10),
      weekdayLabel: 'Monday',
      timeLabel: '10:00',
      durationLabel: '90 minutes',
      sourceLabel: 'Ramble sells the host’s own seats',
      allocation: 8,
      upcomingLabel: '12 sessions open, through 2027-02-01',
    });
  });

  it.each([
    [
      'one session',
      { upcoming: 1, lastDate: '2026-12-07' },
      '1 session open, through 2026-12-07',
    ],
    ['none yet', { upcoming: 0, lastDate: null }, 'No upcoming sessions yet'],
  ])('reads %s', (_label, change, expected) => {
    const [row] = buildAvailabilityView(data([slot(change)])).slots;

    expect(row?.upcomingLabel).toBe(expected);
  });

  it('names the host’s zone and an allocation source in words', () => {
    const view = buildAvailabilityView(
      data([slot({ source: 'allocation', durationMinutes: 1 })]),
    );

    expect(view.timeZone).toBe('America/New_York');
    expect(view.slots[0]).toMatchObject({
      sourceLabel: 'A block of seats the host’s own system gives Ramble',
      durationLabel: '1 minute',
    });
  });
});

describe('the audit rows', () => {
  const template = {
    id: id(10),
    experienceId,
    weekday: 6,
    startTime: '10:00:00',
    durationMinutes: 120,
    allocation: 8,
    source: 'allocation',
  } as const;

  it('records a slot with what it was set up as, in codes and numbers only', () => {
    const entry = slotAddedEntry(id(2), template, 12);

    expect(entry).toMatchObject({
      action: 'session_template.created',
      subjectKind: 'session_template',
      subjectId: id(10),
      details: { start_time: '10:00:00', sessions_created: 12 },
    });
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });

  it('records a seat change with the old number, the new one and how many sessions moved', () => {
    const entry = slotSeatsChangedEntry(id(2), template, {
      from: 8,
      to: 12,
      sessionsUpdated: 5,
    });

    expect(entry.details).toEqual({
      experience_id: experienceId,
      from_allocation: 8,
      to_allocation: 12,
      sessions_updated: 5,
    });
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });
});

describe('the form copy', () => {
  it('names the host’s zone in the intro and the start time hint', () => {
    expect(slotsIntro('America/Chicago')).toContain('America/Chicago');
    expect(startTimeHint('America/Chicago')).toBe(
      'Like 14:00, on the host’s clock in America/Chicago.',
    );
  });

  it('limits a seat count to the digits of the most seats', () => {
    expect(seatsMaxLength).toBe(4);
  });
});
