import { describe, expect, it } from 'vitest';
import {
  AuditExportPayloadSchema,
  ExportDaySchema,
  actorMatchesKind,
  auditLimits,
  emptyExportTally,
  exportDayReady,
  exportDaysDue,
  exportDedupeKey,
  exportLines,
  exportManifest,
  exportManifestKey,
  exportPartKey,
  exportStep,
  exportWindow,
  isAuditAction,
  parseAuditEntry,
  type AuditRow,
} from './audit';
import { dedupeKeyPattern, jobLimits } from './jobs';
import { maxObjectBytes, visibilityOfKey } from './storage';

// Behaviours under test, one per decision, branch or risk:
// - an action is two or more dotted lower-case words within 64 characters
// - an entry names the user exactly when the actor is a user; the ids are lower-cased; unknown fields are refused
// - details are a flat object of at most 16 keys; keys, integers, booleans, null and short id-like strings pass; names, addresses, sentences, nesting, fractions, unsafe integers and an own `__proto__` key do not
// - a refusal never echoes the value it refused
// - an export day is a real calendar date in range, and is ready one hour after it ends (boundary)
// - the pulse queues every ready day from the first row, at most 7, oldest first, and nothing for an empty log
// - the dedupe key and object keys are valid for the jobs table and the audit store
// - a line is the row's fields in a fixed order; the same rows make the same bytes
// - the export step finishes on an empty page, refuses past the part limit, and otherwise writes the next part and says whether it was the last
// - the worst page of the worst rows still fits the store's object cap, and the worst details fit the table's byte cap

const user = '3f2b8a40-5c1d-4e6f-9a7b-1c2d3e4f5a6b';
const subject = '7d1c9b1e-0a2b-4c3d-8e4f-5a6b7c8d9e0f';
const entry = {
  actorKind: 'user',
  actorId: user,
  action: 'order.cancelled',
  subjectKind: 'order',
  subjectId: subject,
  details: { refund_minor: 11050, tier: 'full', notified: true, note: null },
};

describe('isAuditAction', () => {
  it.each([
    ['order.cancelled', true],
    ['payout.changed', true],
    ['role.grant_revoked.by_admin', true],
    ['a.b', true],
    ['order', false],
    ['Order.cancelled', false],
    ['order.', false],
    ['.cancelled', false],
    ['order..cancelled', false],
    ['order.1cancelled', false],
    ['order cancelled', false],
    ['order.cancelled\n', false],
    ['', false],
    [`${'a'.repeat(31)}.${'b'.repeat(32)}`, true],
    [`${'a'.repeat(32)}.${'b'.repeat(32)}`, false],
  ])('%j is %s', (value, expected) => {
    expect(isAuditAction(value)).toBe(expected);
  });

  it('answers an enormous input without walking it', () => {
    const started = performance.now();
    expect(isAuditAction('a.'.repeat(2_000_000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('actorMatchesKind', () => {
  it.each([
    ['user', user, true],
    ['user', null, false],
    ['user', undefined, false],
    ['guest', null, true],
    ['guest', user, false],
    ['system', undefined, true],
    ['system', user, false],
  ] as const)('%s with %s is %s', (kind, actorId, expected) => {
    expect(actorMatchesKind(kind, actorId)).toBe(expected);
  });
});

/** JSON.parse makes `__proto__` an own key; an object literal would set the prototype instead. */
const ownProto = (json: string): unknown => JSON.parse(json);

describe('parseAuditEntry', () => {
  it('accepts a user entry and keeps its details', () => {
    expect(parseAuditEntry(entry)).toEqual(entry);
  });

  it('lower-cases both ids', () => {
    const parsed = parseAuditEntry({
      ...entry,
      actorId: user.toUpperCase(),
      subjectId: subject.toUpperCase(),
    });

    expect([parsed.actorId, parsed.subjectId]).toEqual([user, subject]);
  });

  it.each([
    ['a guest', { actorKind: 'guest', actorId: undefined }],
    ['the system', { actorKind: 'system', actorId: null }],
  ])(
    'takes %s with no actor id, stored as null, and no details as {}',
    (_label, over) => {
      expect(
        parseAuditEntry({ ...entry, ...over, details: undefined }),
      ).toMatchObject({
        actorId: null,
        details: {},
      });
    },
  );

  it.each([
    ['a user with no id', { actorId: undefined }],
    ['a guest with an id', { actorKind: 'guest' }],
    ['an unknown actor kind', { actorKind: 'robot' }],
    ['an id that is not a uuid', { subjectId: 'order-1' }],
    ['an action with one word', { action: 'cancelled' }],
    ['a subject kind with a dot', { subjectKind: 'order.line' }],
    ['a subject kind over 40 characters', { subjectKind: 'a'.repeat(41) }],
    ['a field it does not know', { reason: 'goodwill' }],
  ])('refuses %s', (_label, over) => {
    expect(() => parseAuditEntry({ ...entry, ...over })).toThrow();
  });

  const tooMany = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`key_${String(index)}`, 1]),
  );

  it.each([
    ['a name', { guest: 'Ada Lovelace' }],
    ['an address', { guest: 'ada@example.com' }],
    ['a string over 100 characters', { ref: 'a'.repeat(101) }],
    ['an empty string', { ref: '' }],
    ['a nested object', { ref: { id: 1 } }],
    ['an array', { ref: [1] }],
    ['a fraction', { amount: 10.5 }],
    ['an unsafe integer', { amount: 2 ** 53 }],
    ['a key with a capital', { Amount: 1 }],
    ['a key with a space', { 'a b': 1 }],
    ['a key over 40 characters', { [`k${'a'.repeat(40)}`]: 1 }],
    ['17 keys', tooMany],
    ['an array instead of an object', [1]],
    ['null instead of an object', null],
    ['an own __proto__ key', ownProto('{"__proto__":"Ada Lovelace","ok":1}')],
    ['an own __proto__ object', ownProto('{"__proto__":{"x":1}}')],
  ])('refuses details with %s', (_label, details) => {
    expect(() => parseAuditEntry({ ...entry, details })).toThrow();
  });

  it('accepts exactly 16 keys and a string of exactly 100 characters', () => {
    const details = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [
        `key_${String(index)}`,
        'a'.repeat(100),
      ]),
    );

    expect(parseAuditEntry({ ...entry, details }).details).toEqual(details);
  });

  it('does not echo a refused value', () => {
    const text = (() => {
      try {
        parseAuditEntry({ ...entry, details: { guest: 'ada@example.com' } });
        return '';
      } catch (error) {
        return String(error instanceof Error ? error.message : error);
      }
    })();

    expect(text).not.toContain('ada@example.com');
  });
});

describe('ExportDaySchema', () => {
  it.each([
    ['2026-10-31', true],
    ['2024-02-29', true],
    ['2000-01-01', true],
    ['9998-12-31', true],
    ['2026-02-30', false],
    ['2025-02-29', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['1999-12-31', false],
    ['9999-01-01', false],
    ['2026-10-31T00:00:00Z', false],
    ['', false],
    [`2026-10-31${'0'.repeat(10_000)}`, false],
  ])('%j is %s', (value, expected) => {
    expect(ExportDaySchema.safeParse(value).success).toBe(expected);
  });

  it('refuses extra payload fields', () => {
    expect(
      AuditExportPayloadSchema.safeParse({ day: '2026-10-31', extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe('exportWindow and exportDayReady', () => {
  it('is the UTC day, half open', () => {
    expect(exportWindow('2026-10-31')).toEqual({
      from: new Date('2026-10-31T00:00:00Z'),
      to: new Date('2026-11-01T00:00:00Z'),
    });
  });

  it.each([
    [
      'one millisecond before the grace ends',
      '2026-11-01T00:59:59.999Z',
      false,
    ],
    ['exactly when the grace ends', '2026-11-01T01:00:00.000Z', true],
    ['during the day itself', '2026-10-31T23:59:00Z', false],
    ['days later', '2026-11-09T00:00:00Z', true],
  ])('%s', (_label, now, expected) => {
    expect(exportDayReady('2026-10-31', new Date(now))).toBe(expected);
  });
});

describe('exportDaysDue', () => {
  const at = (iso: string) => new Date(iso);

  it.each([
    ['an empty log', '2026-11-05T12:00:00Z', null, []],
    ['a first row today', '2026-11-05T12:00:00Z', '2026-11-05T09:00:00Z', []],
    [
      'a first row three days back',
      '2026-11-05T12:00:00Z',
      '2026-11-02T10:00:00Z',
      ['2026-11-02', '2026-11-03', '2026-11-04'],
    ],
    [
      'a first row long ago: the lookback, oldest first',
      '2026-11-05T12:00:00Z',
      '2025-01-01T00:00:00Z',
      [
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
      ],
    ],
    [
      'shortly after midnight, yesterday is not ready',
      '2026-11-05T00:30:00Z',
      '2026-11-02T10:00:00Z',
      ['2026-11-02', '2026-11-03'],
    ],
    [
      'a first row in the future',
      '2026-11-05T12:00:00Z',
      '2026-11-09T00:00:00Z',
      [],
    ],
  ])('%s', (_label, now, first, expected) => {
    expect(exportDaysDue(at(now), first === null ? null : at(first))).toEqual(
      expected,
    );
  });

  it('never returns more than the lookback', () => {
    expect(
      exportDaysDue(at('2030-01-01T12:00:00Z'), at('2000-01-01T00:00:00Z')),
    ).toHaveLength(auditLimits.exportLookbackDays);
  });
});

describe('keys', () => {
  it('makes a dedupe key the jobs table accepts', () => {
    const key = exportDedupeKey('2026-10-31');

    expect(key).toMatch(new RegExp(dedupeKeyPattern));
    expect(key.length).toBeLessThanOrEqual(jobLimits.dedupeKeyMaxChars);
  });

  it.each([
    [exportPartKey('2026-10-31', 1), 'audit/2026-10-31/part-0001.ndjson'],
    [exportPartKey('2026-10-31', 50), 'audit/2026-10-31/part-0050.ndjson'],
    [exportManifestKey('2026-10-31'), 'audit/2026-10-31/manifest.ndjson'],
  ])('%s is a key in the audit store', (key, expected) => {
    expect(key).toBe(expected);
    expect(visibilityOfKey(key)).toBe('audit');
  });
});

const row = (id: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  recordedAt: new Date('2026-10-31T14:05:06.789Z'),
  actorKind: 'user',
  actorId: user,
  action: 'order.cancelled',
  subjectKind: 'order',
  subjectId: subject,
  details: { refund_minor: 11050 },
  ...over,
});

describe('exportLines', () => {
  it('writes one line per row with the fields in a fixed order', () => {
    const text = new TextDecoder().decode(
      exportLines([row(1), row(2, { actorKind: 'system', actorId: null })]),
    );

    expect(text).toBe(
      [
        `{"id":1,"recordedAt":"2026-10-31T14:05:06.789Z","actorKind":"user","actorId":"${user}","action":"order.cancelled","subjectKind":"order","subjectId":"${subject}","details":{"refund_minor":11050}}`,
        `{"id":2,"recordedAt":"2026-10-31T14:05:06.789Z","actorKind":"system","actorId":null,"action":"order.cancelled","subjectKind":"order","subjectId":"${subject}","details":{"refund_minor":11050}}`,
        '',
      ].join('\n'),
    );
  });
});

describe('exportStep', () => {
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => row(from + index));

  it('finishes on an empty page', () => {
    expect(exportStep(emptyExportTally, [])).toEqual({ action: 'finish' });
  });

  it('writes the first part, and a short page is the last', () => {
    expect(exportStep(emptyExportTally, page(10, 3))).toEqual({
      action: 'write',
      tally: { parts: 1, rows: 3, firstId: 10, lastId: 12 },
      afterId: 12,
      last: true,
    });
  });

  it('keeps the first id and adds up the parts, and a full page is not the last', () => {
    const first = exportStep(
      emptyExportTally,
      page(1, auditLimits.exportPageRows),
    );
    if (first.action !== 'write') throw new Error('expected a write');

    const second = exportStep(first.tally, page(2001, 5));

    expect(first.last).toBe(false);
    expect(second).toMatchObject({
      tally: {
        parts: 2,
        rows: auditLimits.exportPageRows + 5,
        firstId: 1,
        lastId: 2005,
      },
      afterId: 2005,
    });
  });

  it('writes the last allowed part and refuses the one after', () => {
    const tally = {
      parts: auditLimits.exportMaxParts - 1,
      rows: 1,
      firstId: 1,
      lastId: 1,
    };

    expect(exportStep(tally, page(2, 1)).action).toBe('write');
    expect(
      exportStep({ ...tally, parts: auditLimits.exportMaxParts }, page(2, 1)),
    ).toEqual({ action: 'refuse' });
  });
});

describe('exportManifest', () => {
  it('says the day, the parts, the rows, and the ids, for an empty day too', () => {
    const text = new TextDecoder().decode(
      exportManifest('2026-10-31', emptyExportTally),
    );

    expect(JSON.parse(text)).toEqual({
      day: '2026-10-31',
      parts: 0,
      rows: 0,
      firstId: null,
      lastId: null,
    });
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('the size limits agree', () => {
  const worstDetails = Object.fromEntries(
    Array.from({ length: auditLimits.detailsMaxKeys }, (_, index) => [
      `${'k'.repeat(auditLimits.detailsKeyMaxChars - 2)}${String(index).padStart(2, '0')}`,
      'v'.repeat(auditLimits.detailsValueMaxChars),
    ]),
  );
  const worst = parseAuditEntry({
    ...entry,
    action: `${'a'.repeat(31)}.${'b'.repeat(32)}`,
    subjectKind: 'k'.repeat(auditLimits.subjectKindMaxChars),
    details: worstDetails,
  });

  it('fits the worst details under the table byte cap, even with the spaces Postgres adds', () => {
    const keys = auditLimits.detailsMaxKeys;
    const postgresText = JSON.stringify(worst.details).length + 2 * keys;

    expect(postgresText).toBeLessThan(auditLimits.detailsStoredMaxBytes);
  });

  it('fits a full page of the worst rows under the storage object cap', () => {
    const rows = Array.from(
      { length: auditLimits.exportPageRows },
      (_, index) =>
        row(index + 1, {
          ...worst,
          id: 9_000_000_000 + index,
          details: worst.details,
        }),
    );

    expect(exportLines(rows).byteLength).toBeLessThan(maxObjectBytes);
  });
});
