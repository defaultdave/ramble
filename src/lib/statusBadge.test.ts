import { describe, expect, it } from 'vitest';
import { resolveBadgeTone } from './badge';
import {
  parseStatusFilter,
  parseStatusParam,
  statusBadgeTone,
  statusFilter,
  statusFilterChips,
  type StatusFilterOption,
} from './statusBadge';

// Behaviours under test, one per decision, branch or risk:
// - a list's status filter offers its statuses in words and reads the one the address names
// - every status tone maps to a tone the Badge knows, not its neutral fallback
// - an address that names no offered status means all
// - a status param is read only when it is offered and is also one of the typed statuses
// - the chips are All plus each option, one selected, each from the first page with the rest of the address kept
// - a count shows in the label only when given

const options: StatusFilterOption[] = [
  { value: 'failed', label: 'Failed', count: 3 },
  { value: 'paid', label: 'Paid' },
];

describe('statusBadgeTone', () => {
  it.each(Object.entries(statusBadgeTone))('%s -> %s', (_status, tone) => {
    expect(resolveBadgeTone(tone)).toBe(tone);
  });
});

describe('parseStatusFilter', () => {
  it.each([
    ['failed', 'failed'],
    ['refunded', null],
    ['', null],
    [undefined, null],
    [['failed', 'paid'], null],
    [['failed'], 'failed'],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseStatusFilter(raw, options)).toBe(expected);
  });
});

describe('parseStatusParam', () => {
  const statuses = ['failed', 'paid'] as const;
  it.each([
    ['failed', 'failed'],
    ['paid', 'paid'],
    ['refunded', null],
    [['failed', 'paid'], null],
    [undefined, null],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseStatusParam(raw, statuses, options)).toBe(expected);
  });

  it('refuses an offered option that is not one of the statuses', () => {
    expect(parseStatusParam('paid', ['failed'], options)).toBeNull();
  });
});

describe('statusFilterChips', () => {
  it('selects All when no status is named', () => {
    const chips = statusFilterChips({ path: '/ops', query: {}, options });
    expect(chips.map(({ id, selected }) => [id, selected])).toEqual([
      ['all', true],
      ['failed', false],
      ['paid', false],
    ]);
  });

  it('selects the named status, keeps the search, and drops the cursor', () => {
    const chips = statusFilterChips({
      path: '/ops',
      query: { status: 'paid', q: 'gift', cursor: 'c1' },
      options,
    });
    expect(chips.map(({ href, selected }) => [href, selected])).toEqual([
      ['/ops?q=gift', false],
      ['/ops?status=failed&q=gift', false],
      ['/ops?status=paid&q=gift', true],
    ]);
  });

  it('shows a count in the label only when given, and a custom All label', () => {
    const chips = statusFilterChips({
      path: '/ops',
      query: {},
      options,
      allLabel: 'Every order',
    });
    expect(chips.map(({ label }) => label)).toEqual([
      'Every order',
      'Failed (3)',
      'Paid',
    ]);
  });

  it('selects All for a status the filter does not offer', () => {
    const chips = statusFilterChips({
      path: '/ops',
      query: { status: 'nope' },
      options,
    });
    expect(chips[0]?.selected).toBe(true);
  });
});

describe('statusFilter', () => {
  const filter = statusFilter(['open', 'done'] as const, {
    open: 'Open',
    done: 'Done',
  });

  it('offers each status in words, in the list order', () => {
    expect(filter.options).toEqual([
      { value: 'open', label: 'Open' },
      { value: 'done', label: 'Done' },
    ]);
  });

  it.each([
    ['done', 'done'],
    ['nope', null],
    [undefined, null],
    [['open', 'done'], null],
  ])('reads %j as %j', (raw, expected) => {
    expect(filter.parse(raw)).toBe(expected);
  });
});
