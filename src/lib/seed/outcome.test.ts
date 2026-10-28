import { describe, expect, it } from 'vitest';
import { curated } from './fixtures';
import {
  coverageExit,
  curatedLine,
  editorialLine,
  legalLine,
  refusalLine,
  scaleLine,
  startLine,
  stepNames,
  taxonomyLine,
  type CatalogCounts,
} from './outcome';
import { snapshotFromFixtures } from './snapshot';

// Behaviours under test:
// - a refusal and a start print the target's words, and never more than the verdict holds
// - the exit is 0 with the probe count when no probe has a gap, 1 naming the probes when one has
// - a run without the scale fixture skips the scale probes; a run that asked for it is held to them
// - each progress line carries its counts, and a step name carries what it is about

const now = new Date('2026-10-28T15:00:00Z');
const counts: CatalogCounts = {
  hosts: 3,
  experiences: 5,
  templates: 7,
  sessionsCreated: 11,
  sessionsAlreadyThere: 13,
  seatsAdjusted: 17,
};

describe('refusalLine and startLine', () => {
  it('words a refusal and a start', () => {
    expect(
      refusalLine({
        ok: false,
        reason: 'not_local',
        message: 'SEED_TARGET is local but the database is on x.',
      }),
    ).toBe('Refusing to seed: SEED_TARGET is local but the database is on x.');
    expect(
      startLine({ ok: true, target: 'staging', host: 'db.example.com' }),
    ).toBe('Seeding the staging database on db.example.com');
  });
});

describe('coverageExit', () => {
  const snapshot = snapshotFromFixtures(curated, undefined, now);

  it('exits 0 and counts the probes when none has a gap', () => {
    const exit = coverageExit(snapshot, undefined);
    expect(exit.code).toBe(0);
    expect(exit.line).toMatch(/^Coverage matrix: \d+ probes checked, no gaps$/);
  });

  it('exits 1 and names the probe when the data lacks a state', () => {
    const exit = coverageExit(
      { ...snapshot, settings: { ...snapshot.settings, giftsEnabled: false } },
      undefined,
    );
    expect(exit.code).toBe(1);
    expect(exit.line).toContain('gift-guide');
  });

  it('holds the scale probe to account only when scale was asked for', () => {
    expect(coverageExit(snapshot, undefined).code).toBe(0);
    const exit = coverageExit(snapshot, { experiences: 5, seed: 1 });
    expect(exit.code).toBe(1);
    expect(exit.line).toContain('many-results');
  });
});

describe('progress lines and step names', () => {
  it('carry their counts', () => {
    expect(taxonomyLine(4, 6)).toBe('Categories 4, neighborhoods 6');
    expect(legalLine(3)).toBe('Legal documents 3');
    expect(curatedLine(counts)).toBe(
      'Curated: 5 experiences, 11 sessions created',
    );
    expect(editorialLine(2, 6, 9)).toBe(
      'Editorial: 2 collections, 6 home modules, 9 page copies',
    );
    expect(scaleLine(counts)).toBe(
      'Scale: 3 hosts, 5 experiences, 11 sessions created',
    );
  });

  it('name what the step is about', () => {
    expect(stepNames.publishLegal('waiver')).toBe('publish waiver');
    expect(stepNames.saveCollection('picks')).toBe('save collection picks');
    expect(stepNames.savePageCopy('category', 'kayaking')).toBe(
      'save category copy kayaking',
    );
  });
});
