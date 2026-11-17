import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  buildReviewModerationRows,
  parseReviewHideForm,
  parseReviewStatus,
  parseReviewUnhideForm,
  reviewFirstName,
  reviewHiddenEntry,
  reviewHideReasons,
  reviewModerationChanged,
  reviewModerationNotices,
  reviewModerationNoticeCodes,
  reviewModerationOutcome,
  reviewStatusAfter,
  reviewUnhiddenEntry,
  type ReviewModerationOutcome,
} from './reviewModeration';

// Behaviours under test:
// - hiding a visible review hides it, and showing a hidden one shows it; the other way round is a named no-op
// - a missing review is not found for both actions
// - only a hide or show that changed the row asks for a cache refresh
// - the status filter reads one known status and nothing else
// - a hide form needs an id and one of the reasons offered; a show form needs an id; an oversized field is refused
// - the table shows the first name only, a stand-in for none, and the time in New York
// - every notice code has text, and the audit entries are valid rows holding the reason as a code and no review text

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const user = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const getter = (fields: Record<string, unknown>) => (name: string) =>
  fields[name];

describe('reviewModerationOutcome', () => {
  it.each([
    ['visible', 'hide', 'hidden'],
    ['hidden', 'hide', 'already_hidden'],
    ['hidden', 'unhide', 'unhidden'],
    ['visible', 'unhide', 'already_visible'],
  ] as const)('a %s review under %s is %s', (status, action, expected) => {
    expect(reviewModerationOutcome({ status }, action)).toBe(expected);
  });

  it.each(['hide', 'unhide'] as const)('is not found for %s', (action) => {
    expect(reviewModerationOutcome(undefined, action)).toBe('not_found');
  });

  it('names the status each action leaves', () => {
    expect(reviewStatusAfter).toEqual({ hide: 'hidden', unhide: 'visible' });
  });
});

describe('reviewModerationChanged', () => {
  it.each([
    ['hidden', true],
    ['unhidden', true],
    ['already_hidden', false],
    ['already_visible', false],
    ['not_found', false],
  ] as [ReviewModerationOutcome, boolean][])('%s is %s', (outcome, changed) => {
    expect(reviewModerationChanged(outcome)).toBe(changed);
  });
});

describe('parseReviewStatus', () => {
  it.each([
    ['hidden', 'hidden'],
    ['visible', 'visible'],
    [undefined, null],
    ['removed', null],
    [['hidden', 'visible'], null],
  ])('reads %s as %s', (raw, expected) => {
    expect(parseReviewStatus(raw)).toBe(expected);
  });
});

describe('parseReviewHideForm', () => {
  it.each(reviewHideReasons)('accepts the reason %s', (reason) => {
    expect(parseReviewHideForm(getter({ id, reason }))).toEqual({
      ok: true,
      value: { id, reason },
    });
  });

  it('lower-cases the id', () => {
    expect(
      parseReviewHideForm(getter({ id: id.toUpperCase(), reason: 'spam' })),
    ).toEqual({ ok: true, value: { id, reason: 'spam' } });
  });

  it.each([
    ['no reason', { id }],
    ['a blank reason', { id, reason: '  ' }],
    ['a reason that is not offered', { id, reason: 'because I said so' }],
    ['no id', { reason: 'spam' }],
    ['an id that is not one', { id: 'abc', reason: 'spam' }],
    ['an oversized reason', { id, reason: 'x'.repeat(201) }],
    ['a reason that is not text', { id, reason: 5 }],
  ])('refuses %s', (_name, fields) => {
    expect(parseReviewHideForm(getter(fields))).toEqual({ ok: false });
  });
});

describe('parseReviewUnhideForm', () => {
  it('accepts an id', () => {
    expect(parseReviewUnhideForm(getter({ id }))).toEqual({
      ok: true,
      value: { id },
    });
  });

  it.each([
    ['no id', {}],
    ['an id that is not one', { id: 'abc' }],
    ['an oversized id', { id: 'x'.repeat(201) }],
  ])('refuses %s', (_name, fields) => {
    expect(parseReviewUnhideForm(getter(fields))).toEqual({ ok: false });
  });
});

describe('reviewFirstName', () => {
  it.each([
    ['Pat Smith', 'Pat'],
    ['  Sam   Lee ', 'Sam'],
    ['Cher', 'Cher'],
    [null, 'A guest'],
    ['   ', 'A guest'],
  ])('shows %j as %s', (name, expected) => {
    expect(reviewFirstName(name)).toBe(expected);
  });

  it('cuts a very long name', () => {
    expect(reviewFirstName('x'.repeat(500)).length).toBeLessThan(200);
  });
});

describe('buildReviewModerationRows', () => {
  it('shows the first name, the rating in words, and the time in New York', () => {
    const [row] = buildReviewModerationRows([
      {
        id,
        experienceName: 'Pottery wheel night',
        rating: 4,
        body: 'Lovely.',
        guestName: 'Pat Smith',
        status: 'hidden',
        createdAt: new Date('2026-11-09T15:30:00Z'),
      },
    ]);
    expect(row).toEqual({
      id,
      experienceName: 'Pottery wheel night',
      ratingText: '4 out of 5',
      body: 'Lovely.',
      firstName: 'Pat',
      status: 'hidden',
      writtenLabel: 'Mon, Nov 9, 10:30 AM EST',
    });
  });
});

describe('notices', () => {
  it('has text for every code', () => {
    expect(Object.keys(reviewModerationNotices).sort()).toEqual(
      [...reviewModerationNoticeCodes].sort(),
    );
  });
});

describe('audit entries', () => {
  it('records a hide with the reason code and no text', () => {
    expect(
      parseAuditEntry(reviewHiddenEntry(user, id, 'personal_info')),
    ).toMatchObject({
      action: 'review.hidden',
      subjectKind: 'review',
      subjectId: id,
      actorId: user,
      details: { reason: 'personal_info' },
    });
  });

  it('records a show with no details', () => {
    expect(parseAuditEntry(reviewUnhiddenEntry(user, id))).toMatchObject({
      action: 'review.unhidden',
      subjectKind: 'review',
      subjectId: id,
      details: {},
    });
  });
});
