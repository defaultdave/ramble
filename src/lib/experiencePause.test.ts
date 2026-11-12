import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import { parseAuditEntry } from './audit';
import { experienceStatuses } from './catalog';
import { experiencePauseEntry } from './experienceAudit';
import { experienceNoticeCodes } from './experienceEditor';
import {
  experienceOutcome,
  hostChanges,
  hostOutcome,
  pauseNoticeCodes,
  pauseNoticeFor,
  pauseNoticeOf,
  pauseRefusal,
  pauseTransitions,
  suspensionLiveText,
  suspensionUndoText,
} from './experiencePause';
import { reviewNoticeCodes } from './experienceReview';
import { hostSuspensionEntry } from './hostAudit';
import { hostNoticeCodes, hostPageNotice } from './hostSetup';
import { experiencePageNotice, photoNoticeCodes } from './photoForm';

// Behaviours under test:
// - only a live experience can be paused and only a paused one unpaused; every other status is refused with the matching code
// - an unpause is refused while the host is suspended, after the status check, and a pause is not
// - a pause leads to paused and an unpause to live
// - one experience reports paused or unpaused; a host reports suspended or unsuspended when it changed anything, and a nothing code when it did not
// - a host change counts when it moves an experience or flips the suspension, even with nothing to move
// - every notice code has a notice, and no code means no notice
// - no pause code is also a host, experience or photo notice code, so the host and experience pages read one address unambiguously, and each page resolves a pause notice and its own
// - the sentences for the host's suspension follow the counts: none, one, many
// - the pause audit row names the user, the statuses and whether a host suspension did it, and the audit log accepts it
// - the host suspension audit row carries the count and no text, and the audit log accepts it

describe('pauseRefusal', () => {
  it.each(experienceStatuses)('pausing from %s', (status) => {
    expect(pauseRefusal(status, 'pause', false)).toEqual(
      status === 'live' ? null : { status: 'not_live' },
    );
  });

  it.each(experienceStatuses)('unpausing from %s', (status) => {
    expect(pauseRefusal(status, 'unpause', false)).toEqual(
      status === 'paused' ? null : { status: 'not_paused' },
    );
  });

  it('refuses an unpause while the host is suspended, but not a pause, and checks the status first', () => {
    expect(pauseRefusal('paused', 'unpause', true)).toEqual({
      status: 'host_suspended',
    });
    expect(pauseRefusal('live', 'pause', true)).toBeNull();
    expect(pauseRefusal('live', 'unpause', true)).toEqual({
      status: 'not_paused',
    });
  });

  it('leads a pause to paused and an unpause to live', () => {
    expect(pauseTransitions.pause.to).toBe('paused');
    expect(pauseTransitions.unpause.to).toBe('live');
  });
});

describe('the outcomes', () => {
  it.each([
    ['pause', 'paused'],
    ['unpause', 'unpaused'],
  ] as const)('an experience %s reports %s', (kind, outcome) => {
    expect(experienceOutcome(kind)).toBe(outcome);
  });

  it.each([
    ['pause', true, 'suspended'],
    ['pause', false, 'nothing_to_suspend'],
    ['unpause', true, 'unsuspended'],
    ['unpause', false, 'nothing_to_unsuspend'],
  ] as const)('a host %s, changed %s, reports %s', (kind, changed, outcome) => {
    expect(hostOutcome(kind, changed)).toBe(outcome);
  });

  it.each([
    ['pause', 2, false, true],
    ['pause', 0, false, true],
    ['pause', 0, true, false],
    ['unpause', 1, true, true],
    ['unpause', 0, true, true],
    ['unpause', 0, false, false],
  ] as const)(
    'a host %s with %s to move, suspended %s, changes: %s',
    (kind, moved, suspended, changed) => {
      expect(hostChanges(kind, moved, suspended)).toBe(changed);
    },
  );
});

describe('the notices', () => {
  it.each(pauseNoticeCodes)('has a notice for %s', (code) => {
    expect(pauseNoticeFor(code)?.title).toBeTruthy();
  });

  it('has none for no code', () => {
    expect(pauseNoticeFor(null)).toBeNull();
  });

  it.each([
    ['host', hostNoticeCodes],
    ['experience', experienceNoticeCodes],
    ['photo', photoNoticeCodes],
  ])('shares no code with the %s notices', (_name, codes) => {
    const shared = codes.filter((code) =>
      (pauseNoticeCodes as readonly string[]).includes(code),
    );

    expect(shared).toEqual([]);
  });

  it('keeps the review page its own host_suspended notice for the same refusal', () => {
    expect(reviewNoticeCodes).toContain('host_suspended');
  });

  it.each([
    ['suspended', 'Host suspended. Its live experiences are paused.'],
    ['host_suspended', undefined],
    ['nonsense', null],
  ])('reads %s from an address on the host page', (code, title) => {
    expect(hostPageNotice(code)?.title ?? null).toBe(
      title === undefined ? pauseNoticeFor('host_suspended')?.title : title,
    );
  });

  it('reads a host notice before a pause one on the host page, and a pause one on the experience page', () => {
    expect(hostPageNotice('updated')?.title).toBe('Host saved.');
    expect(experiencePageNotice('paused').notice?.title).toBe(
      pauseNoticeFor('paused')?.title,
    );
    expect(experiencePageNotice('updated').notice?.title).toBe(
      'Experience saved.',
    );
    expect(pauseNoticeOf(['paused', 'unpaused'])).toBeNull();
  });
});

describe('the suspension sentences', () => {
  it.each([
    [0, /no live experiences.*records the suspension/],
    [1, /pauses 1 experience that is live/],
    [4, /pauses 4 experiences that are live/],
  ])('say what suspending does with %s live', (count, expected) => {
    expect(suspensionLiveText(count)).toMatch(expected);
  });

  it.each([
    [0, /paused nothing that is still paused/],
    [1, /the 1 experience paused by the suspension/],
    [3, /the 3 experiences paused by the suspension/],
  ])('say what unsuspending does with %s paused', (count, expected) => {
    expect(suspensionUndoText(count)).toMatch(expected);
  });
});

describe('the audit rows', () => {
  it.each([
    ['pause', 'experience.paused', 'live', 'paused', false],
    ['unpause', 'experience.unpaused', 'paused', 'live', true],
  ] as const)(
    'an experience %s',
    (kind, action, from, to, viaHostSuspension) => {
      const entry = experiencePauseEntry(id(1), id(2), kind, viaHostSuspension);

      expect(parseAuditEntry(entry)).toMatchObject({
        actorKind: 'user',
        actorId: id(1),
        action,
        subjectKind: 'experience',
        subjectId: id(2),
        details: {
          from_status: from,
          to_status: to,
          via_host_suspension: viaHostSuspension,
        },
      });
    },
  );

  it.each([
    ['pause', 'host.suspended'],
    ['unpause', 'host.unsuspended'],
  ] as const)('a host %s', (kind, action) => {
    expect(
      parseAuditEntry(hostSuspensionEntry(id(1), id(3), kind, 4)),
    ).toMatchObject({
      action,
      subjectKind: 'host',
      subjectId: id(3),
      details: { experiences_changed: 4 },
    });
  });
});
