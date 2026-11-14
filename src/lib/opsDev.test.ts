import { describe, expect, it } from 'vitest';
import {
  buildOpsJobRow,
  devConsoleOpen,
  holdsDevConsoleRole,
  nextClockInstant,
  parseClockForm,
  parseStoredClock,
  reportCounts,
  reportLine,
  runNoticeHref,
  utcLabel,
} from './opsDev';

// Behaviours under test:
// - ops and admin hold the console's role; a guest, a host role and nobody do not
// - the console is closed on production and open on preview, development and where no environment is named
// - a clock form names set, advance or reset; a missing, unknown or out-of-bounds value is refused
// - a set time with no zone is read as UTC
// - advancing moves the test time on, or the real time when none is set; reset clears it
// - a stored test time that is not a time reads as none
// - a job row says its status in words, its attempts as "n of max", and is runnable only while waiting
// - a run's address carries whole-number counts only, and the line it shows is built from those and no other text

const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;

describe('holdsDevConsoleRole', () => {
  it.each([
    [['ops'], true],
    [['admin'], true],
    [['guest', 'ops'], true],
    [['guest'], false],
    [['host_owner'], false],
    [[], false],
  ])('roles %j -> %s', (roles, expected) => {
    expect(holdsDevConsoleRole(roles)).toBe(expected);
  });
});

describe('devConsoleOpen', () => {
  it.each([
    ['production', false],
    ['preview', true],
    ['development', true],
    [undefined, true],
  ])('VERCEL_ENV %s -> %s', (vercelEnv, expected) => {
    expect(devConsoleOpen(vercelEnv)).toBe(expected);
  });
});

describe('parseClockForm', () => {
  it.each([
    ['reset', { intent: 'reset' }, { ok: true, value: { kind: 'reset' } }],
    [
      'a set time with no zone, read as UTC',
      { intent: 'set', at: '2026-11-20T09:30' },
      {
        ok: true,
        value: { kind: 'set', at: new Date('2026-11-20T09:30:00.000Z') },
      },
    ],
    [
      'a set time with an offset',
      { intent: 'set', at: '2026-11-20T09:30:00+02:00' },
      {
        ok: true,
        value: { kind: 'set', at: new Date('2026-11-20T07:30:00.000Z') },
      },
    ],
    [
      'an advance',
      { intent: 'advance', amount: '3', unit: 'days' },
      { ok: true, value: { kind: 'advance', by: 3, unit: 'days' } },
    ],
    ['no intent', {}, { ok: false }],
    ['an unknown intent', { intent: 'rewind' }, { ok: false }],
    ['a set with no time', { intent: 'set' }, { ok: false }],
    ['a set with a bad time', { intent: 'set', at: 'tomorrow' }, { ok: false }],
    [
      'an advance of zero',
      { intent: 'advance', amount: '0', unit: 'days' },
      { ok: false },
    ],
    [
      'an advance too large',
      { intent: 'advance', amount: '10000', unit: 'days' },
      { ok: false },
    ],
    [
      'an advance that is not a whole number',
      { intent: 'advance', amount: '1.5', unit: 'days' },
      { ok: false },
    ],
    [
      'an advance in an unknown unit',
      { intent: 'advance', amount: '1', unit: 'weeks' },
      { ok: false },
    ],
  ])('%s', (_name, fields, expected) => {
    expect(parseClockForm(form(fields))).toEqual(expected);
  });
});

describe('nextClockInstant', () => {
  const realNow = new Date('2026-11-13T12:00:00.000Z');
  const current = new Date('2026-11-20T08:00:00.000Z');

  it.each([
    [
      'set replaces the time',
      { kind: 'set', at: current } as const,
      null,
      current,
    ],
    [
      'advance from the real time when none is set',
      { kind: 'advance', by: 2, unit: 'hours' } as const,
      null,
      new Date('2026-11-13T14:00:00.000Z'),
    ],
    [
      'advance from the test time when one is set',
      { kind: 'advance', by: 1, unit: 'days' } as const,
      current,
      new Date('2026-11-21T08:00:00.000Z'),
    ],
    ['reset clears the time', { kind: 'reset' } as const, current, null],
  ])('%s', (_name, instruction, from, expected) => {
    expect(nextClockInstant(instruction, from, realNow)).toEqual(expected);
  });
});

describe('parseStoredClock', () => {
  it.each([
    ['2026-11-20T08:00:00.000Z', new Date('2026-11-20T08:00:00.000Z')],
    ['garbage', null],
    ['', null],
    [undefined, null],
  ])('%s', (raw, expected) => {
    expect(parseStoredClock(raw)).toEqual(expected);
  });
});

describe('utcLabel', () => {
  it('reads the same in every zone', () => {
    expect(utcLabel(new Date('2026-11-20T08:05:59.000Z'))).toBe(
      '2026-11-20 08:05 UTC',
    );
  });
});

describe('buildOpsJobRow', () => {
  const job = {
    id: 'j1',
    kind: 'guest-confirmation',
    attempts: 1,
    maxAttempts: 5,
    runAfter: new Date('2026-11-20T08:00:00.000Z'),
    lastError: null,
  };

  it.each([
    ['pending', 'Pending', 'info', true],
    ['running', 'Running', 'warning', false],
    ['succeeded', 'Succeeded', 'success', false],
    ['dead', 'Dead', 'danger', false],
  ] as const)('%s', (status, label, tone, runnable) => {
    expect(buildOpsJobRow({ ...job, status })).toEqual({
      id: 'j1',
      kind: 'guest-confirmation',
      statusLabel: label,
      tone,
      attemptsLabel: '1 of 5',
      runAfterLabel: '2026-11-20 08:00 UTC',
      lastError: null,
      runnable,
    });
  });
});

describe('a run result in the address', () => {
  const counts = {
    claimed: 3,
    succeeded: 2,
    retried: 1,
    dead: 0,
    lost: 0,
    unrecorded: 0,
    left: 4,
  };

  it('carries the notice and the counts it names, and not the ones it does not show', () => {
    const href = runNoticeHref('drained', reportCounts(counts));
    expect(href).toBe(
      '/ops/dev?notice=drained&claimed=3&succeeded=2&retried=1&dead=0&lost=0&left=4',
    );
  });

  it('is read back into one line, in a fixed order', () => {
    expect(reportLine({ left: '4', claimed: '3', succeeded: '2' })).toBe(
      '3 claimed, 2 succeeded, 4 still due',
    );
  });

  it.each([
    [{}],
    [{ claimed: 'many' }],
    [{ claimed: '-1' }],
    [{ claimed: ['1', '2'] }],
    [{ claimed: '12345678' }],
  ])('says nothing for %j', (query) => {
    expect(reportLine(query)).toBeNull();
  });
});
