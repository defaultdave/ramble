import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { opsAreaIds } from './opsAudit';
import {
  buildOpsRequestRows,
  requestMessagePreviewChars,
  requestMessageView,
  requestsListEntry,
  type OpsRequestRecord,
} from './opsRequests';

// Behaviours under test, one per decision, branch, or risk:
// - a missing or blank message is none; a short one shows whole with nothing behind it; a long one is cut to one line and keeps its whole text
// - a message that is long only by its line breaks is not cut
// - a row shows the requested day as asked (no zone shift), the group in words, the budget in dollars and the received time in New York
// - an empty list builds no rows
// - the audit row is accepted by the audit log's own parser, names the ops user and the requests area, and holds no name or address

const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';

const record = (over: Partial<OpsRequestRecord> = {}): OpsRequestRecord => ({
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceName: 'Pottery wheel night',
  requestedDate: '2026-11-21',
  groupSize: 12,
  budgetMinor: 120_000,
  name: 'Pat Smith',
  email: 'pat@example.com',
  message: 'A birthday.',
  createdAt: new Date('2026-11-09T15:30:00Z'),
  ...over,
});

describe('requestMessageView', () => {
  it.each([
    [null, null],
    ['', null],
    ['  \n ', null],
    ['  A birthday.  ', { preview: 'A birthday.', full: null }],
    ['Line one.\nLine two.', { preview: 'Line one. Line two.', full: null }],
  ])('reads %j as %j', (message, expected) => {
    expect(requestMessageView(message)).toEqual(expected);
  });

  it('cuts a long message to one line and keeps the whole text', () => {
    const long = 'word '.repeat(requestMessagePreviewChars).trim();
    const view = requestMessageView(long);
    expect(view?.full).toBe(long);
    expect(view?.preview.endsWith('…')).toBe(true);
    expect(Array.from(view?.preview ?? '').length).toBeLessThanOrEqual(
      requestMessagePreviewChars,
    );
  });
});

describe('buildOpsRequestRows', () => {
  it('words the day, group, budget and received time', () => {
    expect(buildOpsRequestRows([record()])).toEqual([
      {
        id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
        experienceName: 'Pottery wheel night',
        requestedLabel: 'Saturday, November 21, 2026',
        groupLabel: '12 guests',
        budgetLabel: '$1,200',
        name: 'Pat Smith',
        email: 'pat@example.com',
        message: { preview: 'A birthday.', full: null },
        receivedLabel: 'Mon, Nov 9, 10:30 AM EST',
      },
    ]);
  });

  it.each([
    [1, '1 guest'],
    [2, '2 guests'],
  ])('words a group of %i as %s', (groupSize, label) => {
    expect(buildOpsRequestRows([record({ groupSize })])[0]?.groupLabel).toBe(
      label,
    );
  });

  it('keeps the requested day whatever the time received, and shows cents only when there are some', () => {
    const [row] = buildOpsRequestRows([
      record({
        requestedDate: '2026-12-01',
        createdAt: new Date('2026-12-01T03:00:00Z'),
        budgetMinor: 15_050,
      }),
    ]);
    expect(row?.requestedLabel).toBe('Tuesday, December 1, 2026');
    expect(row?.receivedLabel).toBe('Mon, Nov 30, 10:00 PM EST');
    expect(row?.budgetLabel).toBe('$150.50');
  });

  it('builds no rows for no records', () => {
    expect(buildOpsRequestRows([])).toEqual([]);
  });
});

describe('requestsListEntry', () => {
  it('is a valid entry naming the ops user and the requests area, with no guest text', () => {
    const entry = requestsListEntry(userId);
    expect(parseAuditEntry(entry)).toMatchObject({
      actorKind: 'user',
      actorId: userId,
      action: 'requests.list_viewed',
      subjectKind: 'ops_area',
      subjectId: opsAreaIds.requests,
    });
    expect(entry).not.toHaveProperty('details');
  });
});
