import { describe, expect, it } from 'vitest';
import {
  collectionTarget,
  describeFailure,
  expectOk,
  expectStatus,
  inChunks,
  legalSeedStep,
  lookup,
  seatUpdates,
  SeedStepError,
  settingsRowMissing,
  templateNotFound,
  templateOutcome,
} from './decide';
import type { PlannedSession } from './plan';

// Behaviours under test:
// - legal: no version creates and publishes; any published version is left alone; drafts only
//   publish the newest draft instead of starting another
// - collections: a new slug creates, the same slug and kind replaces by id, the same slug of another kind is a conflict
// - a refused data-layer answer stops the seed with a message that names the step and reason; a good one passes through
// - a template that already exists is accepted; any other refusal stops the seed
// - a missing lookup names what was missing
// - a template the seed cannot read back is a seed message that names the experience, not a driver error
// - seat updates raise a stored session to the plan, never lower it, and ignore sessions the plan does not name
// - chunks are bounded and cover every item; a size under one is refused
// - a failure prints a seed message as is, and for anything else only the kind and the error code, never the message

describe('legalSeedStep', () => {
  it('creates and publishes when there is no version', () => {
    expect(legalSeedStep([])).toEqual({ action: 'create_and_publish' });
  });

  it('leaves a document alone once any version is published', () => {
    expect(
      legalSeedStep([
        { id: 'a', version: 1, status: 'published' },
        { id: 'b', version: 2, status: 'draft' },
      ]),
    ).toEqual({ action: 'skip' });
  });

  it('publishes the newest draft when only drafts exist', () => {
    expect(
      legalSeedStep([
        { id: 'a', version: 1, status: 'draft' },
        { id: 'c', version: 3, status: 'draft' },
        { id: 'b', version: 2, status: 'draft' },
      ]),
    ).toEqual({ action: 'publish', id: 'c' });
  });
});

describe('collectionTarget', () => {
  const stored = [{ id: 'one', slug: 'rainy', kind: 'pick' }];

  it('creates a collection whose slug is new', () => {
    expect(collectionTarget(stored, 'other', 'pick')).toEqual({
      action: 'create',
    });
  });

  it('replaces the stored collection of the same slug and kind', () => {
    expect(collectionTarget(stored, 'rainy', 'pick')).toEqual({
      action: 'replace',
      id: 'one',
    });
  });

  it('reports a conflict when the slug holds another kind', () => {
    expect(collectionTarget(stored, 'rainy', 'gift_guide')).toEqual({
      action: 'conflict',
    });
  });
});

describe('expectStatus and expectOk', () => {
  it('passes a saved answer through', () => {
    const saved = { status: 'saved' as const, value: 1 };
    expect(expectStatus('save', saved, 'saved')).toBe(saved);
  });

  it('stops on any other status, naming the step and the status', () => {
    const refused = { status: 'slug_taken' } as
      { status: 'slug_taken' } | { status: 'saved' };
    expect(() => expectStatus('save pick', refused, 'saved')).toThrow(
      'Seed step "save pick" was refused: slug_taken',
    );
  });

  it('passes an ok answer through', () => {
    const ok = { ok: true as const, n: 1 };
    expect(expectOk('generate', ok)).toBe(ok);
  });

  it('stops on a refusal with its reason, or says none was given', () => {
    expect(() =>
      expectOk('generate', { ok: false as const, reason: 'beyond_horizon' }),
    ).toThrow('was refused: beyond_horizon');
    expect(() => expectOk('generate', { ok: false as const })).toThrow(
      'was refused: no reason given',
    );
  });
});

describe('templateOutcome', () => {
  it('accepts a created template and an existing slot', () => {
    expect(() => {
      templateOutcome({ ok: true });
      templateOutcome({ ok: false, reason: 'duplicate_slot' });
    }).not.toThrow();
  });

  it('stops on an unknown experience', () => {
    expect(() => {
      templateOutcome({ ok: false, reason: 'experience_not_found' });
    }).toThrow(SeedStepError);
  });
});

describe('lookup', () => {
  it('returns what is found', () => {
    expect(lookup(new Map([['a', 'id']]), 'a', 'thing')).toBe('id');
  });

  it('names what is missing', () => {
    expect(() => lookup(new Map<string, string>(), 'x', 'category')).toThrow(
      'Seed has no category "x"',
    );
  });
});

describe('seatUpdates', () => {
  const plan = (localDate: string, seatsSold: number): PlannedSession => ({
    experienceSlug: 'e',
    weekday: 6,
    startTime: '17:30:00',
    localDate,
    startsAt: new Date(0),
    endsAt: new Date(1),
    timeZone: 'America/New_York',
    allocation: 12,
    seatsSold,
    source: 'ramble',
  });
  const stored = (id: string, localDate: string | null, seatsSold: number) => ({
    id,
    seatsSold,
    weekday: 6,
    startTime: '17:30:00',
    localDate,
  });

  it('raises a session that has sold fewer seats than the plan', () => {
    expect(
      seatUpdates([plan('2026-11-07', 11)], [stored('s1', '2026-11-07', 0)]),
    ).toEqual([{ sessionId: 's1', seatsSold: 11 }]);
  });

  it('does not lower a session that has sold more, or touch one at the plan', () => {
    expect(
      seatUpdates(
        [plan('2026-11-07', 5), plan('2026-11-14', 5)],
        [stored('s1', '2026-11-07', 9), stored('s2', '2026-11-14', 5)],
      ),
    ).toEqual([]);
  });

  it('ignores a plan with no stored session and a stored session with no date or plan', () => {
    expect(
      seatUpdates(
        [plan('2026-11-07', 3), plan('2026-11-14', 0)],
        [stored('s1', null, 0), stored('s2', '2026-11-21', 0)],
      ),
    ).toEqual([]);
  });

  it('matches on weekday, start time, and date together', () => {
    const other = { ...stored('s1', '2026-11-07', 0), startTime: '19:30:00' };
    expect(seatUpdates([plan('2026-11-07', 3)], [other])).toEqual([]);
  });
});

describe('inChunks', () => {
  it('splits into groups no larger than the size and keeps every item', () => {
    const chunks = inChunks([1, 2, 3, 4, 5], 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('gives no chunks for no items', () => {
    expect(inChunks([], 3)).toEqual([]);
  });

  it.each([0, -1, 1.5])('refuses the size %s', (size) => {
    expect(() => inChunks([1], size)).toThrow(RangeError);
  });
});

describe('describeFailure', () => {
  it('prints a seed message as it is', () => {
    expect(
      describeFailure(new SeedStepError('Seed step "x" was refused: no')),
    ).toBe('Seed step "x" was refused: no');
  });

  it('prints only the kind and code of a driver error, never its message', () => {
    const driver = Object.assign(
      new Error('insert into "hosts" values ($1) params: hunter2'),
      { code: '23505' },
    );
    const wrapped = new Error('Failed query: select secret', { cause: driver });
    expect(describeFailure(wrapped)).toBe('Seed failed: Error (23505)');
    expect(describeFailure(driver)).not.toMatch(/hunter2|insert/);
  });

  it('prints the kind alone when there is no code, and copes with a non-error', () => {
    expect(describeFailure(new TypeError('boom with secrets'))).toBe(
      'Seed failed: TypeError',
    );
    expect(describeFailure('a string')).toBe('Seed failed: Unknown error');
  });

  it('stops following causes after a few levels', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(
      describeFailure(Object.assign(new Error('x'), { cause: loop })),
    ).toBe('Seed failed: Error');
  });

  it('ignores a code that is not a short upper-case token', () => {
    expect(
      describeFailure(
        Object.assign(new Error('x'), { code: 'select * from t' }),
      ),
    ).toBe('Seed failed: Error');
  });
});

describe('templateNotFound', () => {
  it('is a seed message that names the experience', () => {
    const error = templateNotFound('kayak');
    expect(error).toBeInstanceOf(SeedStepError);
    expect(error.message).toBe(
      'Seed step "find session template" found none for kayak',
    );
  });
});

describe('settingsRowMissing', () => {
  it('is a seed message that names the step', () => {
    const error = settingsRowMissing();
    expect(error).toBeInstanceOf(SeedStepError);
    expect(error.message).toBe(
      'Seed step "read settings" found no settings row',
    );
  });
});
