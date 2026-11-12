import { describe, expect, it } from 'vitest';
import { supportLimits } from './support';
import {
  buildSupportQueueRows,
  parseSupportResolveForm,
  parseSupportStatus,
  supportListEntry,
  supportResolvedEntry,
  supportResolveOutcome,
  supportStatusOf,
  type SupportQueueRecord,
} from './supportQueue';
import { parseAuditEntry } from './audit';

// Behaviours under test, one per decision, branch, or risk:
// - the status filter reads one known status; none, a repeated one, or an unknown one is every request
// - a request is open until it has a resolution time
// - a row shows the reason in words and the times in New York, and carries its resolution only once resolved
// - the resolve form needs a request id (lower-cased) and a note that is not blank and within the limit
// - an oversized field is refused unread, and a field the form does not know is not accepted
// - a missing request is not found, an open one resolves, a resolved one is left as it was
// - both audit rows are accepted by the audit log's own parser, name the ops user, and hold no note or address

const requestId = '0F1E2D3C-4B5A-4697-8A9B-0C1D2E3F4A5B';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';

const record = (
  over: Partial<SupportQueueRecord> = {},
): SupportQueueRecord => ({
  id: requestId.toLowerCase(),
  name: 'Pat Smith',
  email: 'pat@example.com',
  topic: 'refund',
  message: 'I was charged twice.',
  createdAt: new Date('2026-11-09T15:30:00Z'),
  resolvedAt: null,
  resolutionNote: null,
  ...over,
});

const form = (fields: Record<string, unknown>) => (name: string) =>
  fields[name] ?? null;

describe('parseSupportStatus', () => {
  it.each([
    ['open', 'open'],
    ['resolved', 'resolved'],
    [undefined, null],
    ['closed', null],
    [['open', 'resolved'], null],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseSupportStatus(raw)).toBe(expected);
  });
});

describe('supportStatusOf', () => {
  it.each([
    [null, 'open'],
    [new Date('2026-11-10T12:00:00Z'), 'resolved'],
  ])('a resolution time of %j is %s', (resolvedAt, status) => {
    expect(supportStatusOf({ resolvedAt })).toBe(status);
  });
});

describe('buildSupportQueueRows', () => {
  it('shows an open request with its reason in words and the time in New York', () => {
    expect(buildSupportQueueRows([record()])).toEqual([
      {
        id: requestId.toLowerCase(),
        name: 'Pat Smith',
        email: 'pat@example.com',
        reason: 'A refund or payment',
        message: 'I was charged twice.',
        receivedLabel: 'Mon, Nov 9, 10:30 AM EST',
        status: 'open',
        resolution: null,
      },
    ]);
  });

  it('carries the note and the time once resolved', () => {
    const [row] = buildSupportQueueRows([
      record({
        resolvedAt: new Date('2026-11-10T18:00:00Z'),
        resolutionNote: 'Refunded the duplicate.',
      }),
    ]);
    expect(row).toMatchObject({
      status: 'resolved',
      resolution: {
        note: 'Refunded the duplicate.',
        whenLabel: 'Tue, Nov 10, 1:00 PM EST',
      },
    });
  });
});

describe('parseSupportResolveForm', () => {
  it('reads the id lower-cased and the note trimmed', () => {
    expect(
      parseSupportResolveForm(form({ id: requestId, note: '  Replied.  ' })),
    ).toEqual({
      ok: true,
      value: { id: requestId.toLowerCase(), note: 'Replied.' },
    });
  });

  it.each([
    ['no note', { id: requestId }],
    ['a blank note', { id: requestId, note: '   ' }],
    ['no id', { note: 'Replied.' }],
    ['an id that is not one', { id: 'not-an-id', note: 'Replied.' }],
    [
      'a note over the limit',
      {
        id: requestId,
        note: 'x'.repeat(supportLimits.resolutionNoteMaxChars + 1),
      },
    ],
    ['an oversized field', { id: requestId, note: 'x'.repeat(5000) }],
    ['a note that is not text', { id: requestId, note: new Blob(['x']) }],
  ])('refuses %s', (_name, fields) => {
    expect(parseSupportResolveForm(form(fields))).toEqual({ ok: false });
  });

  it('accepts a note of exactly the limit', () => {
    const note = 'x'.repeat(supportLimits.resolutionNoteMaxChars);
    expect(parseSupportResolveForm(form({ id: requestId, note })).ok).toBe(
      true,
    );
  });
});

describe('supportResolveOutcome', () => {
  it.each([
    [undefined, 'not_found'],
    [{ resolvedAt: null }, 'resolved'],
    [{ resolvedAt: new Date('2026-11-10T12:00:00Z') }, 'already_resolved'],
  ] as const)('a row of %j is %s', (row, outcome) => {
    expect(supportResolveOutcome(row)).toBe(outcome);
  });
});

describe('the audit rows', () => {
  it('are valid entries naming the ops user and the subject by id only', () => {
    const listed = parseAuditEntry(supportListEntry(userId));
    const resolved = parseAuditEntry(
      supportResolvedEntry(userId, requestId.toLowerCase()),
    );
    expect(listed).toMatchObject({
      action: 'support.list_viewed',
      actorId: userId,
    });
    expect(resolved).toMatchObject({
      action: 'support.resolved',
      subjectKind: 'support_request',
      subjectId: requestId.toLowerCase(),
    });
    expect(resolved.details).toEqual({});
  });
});
