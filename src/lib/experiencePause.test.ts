import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import { parseAuditEntry } from './audit';
import { experienceStatuses, guestVisibleStatuses } from './catalog';
import { experiencePauseEntry } from './experienceAudit';
import { experienceNoticeCodes } from './experienceEditor';
import {
  experienceOutcome,
  hostChanges,
  hostOutcome,
  pausableStatuses,
  pauseActionFor,
  pauseActionLabel,
  pauseExplainerText,
  pauseNoticeFor,
  pauseNoticeOf,
  pauseRefusal,
  restoredStatus,
  movedStatus,
  leavesSuspended,
  suspensionActionLabel,
  hostSuspendedText,
  suspensionLiveText,
  suspensionUndoText,
  type PauseNoticeCode,
} from './experiencePause';
import { reviewNoticeCodes } from './experienceReview';
import { hostSuspensionEntry } from './hostAudit';
import { hostNoticeCodes, hostPageNotice } from './hostSetup';
import { experiencePageNotice, photoNotices } from './photoForm';

// Behaviours under test:
// - the statuses a pause takes down are exactly the ones guests can see, so a status added to the public set fails here until it is handled
// - the action a status offers: pause for each of those, unpause for paused, none for the rest
// - an unpause restores the status the latest pause recorded, and live when there is none or it is not one a pause can come from, and a guide entry that lost its link out while paused comes back live
// - only an experience guests can see can be paused and only a paused one unpaused; every other status is refused with the matching code
// - an unpause is refused while the host is suspended, after the status check, and a pause is not
// - one experience reports paused or unpaused; a host reports suspended or unsuspended when it changed anything, and a nothing code when it did not
// - a host change counts when it moves an experience or flips the suspension, even with nothing to move
// - every notice code has a notice, and no code means no notice
// - no pause code is also a host, experience or photo notice code, so the host and experience pages read one address unambiguously, and each page resolves a pause notice and its own
// - the statuses a pause and an unpause move between, and what leaves a host suspended
// - the button and explainer of each action, and the host suspension labels
// - the unpaused and unsuspended notices say restored, not live
// - the sentences for the host's suspension follow the counts: none, one, many
// - the pause audit row names the user, the statuses and whether a host suspension did it, and the audit log accepts it
// - the host suspension audit row carries the count and no text, and the audit log accepts it

const pausable: readonly string[] = pausableStatuses;

describe('the statuses a pause takes down', () => {
  it('are the ones guests can see', () => {
    expect([...pausableStatuses].sort()).toEqual(
      [...guestVisibleStatuses].sort(),
    );
  });

  it.each(experienceStatuses)('offers the action for %s', (status) => {
    const expected = pausable.includes(status)
      ? 'pause'
      : status === 'paused'
        ? 'unpause'
        : null;

    expect(pauseActionFor(status)).toBe(expected);
  });

  it.each([
    ['guide_only', true, 'guide_only'],
    ['guide_only', false, 'live'],
    ['live', true, 'live'],
    [null, true, 'live'],
    ['draft', true, 'live'],
    ['paused', true, 'live'],
  ])('restores %s with a link out %s as %s', (pausedFrom, link, restored) => {
    expect(restoredStatus(pausedFrom, link)).toBe(restored);
  });
});

describe('the moves and the suspension rule', () => {
  it.each([
    ['pause', 'live', null, { from: 'live', to: 'paused' }],
    ['pause', 'guide_only', 'live', { from: 'guide_only', to: 'paused' }],
    ['unpause', 'paused', 'guide_only', { from: 'paused', to: 'guide_only' }],
    ['unpause', 'paused', null, { from: 'paused', to: 'live' }],
  ] as const)('%s from %s restoring %s', (kind, status, restored, expected) => {
    expect(movedStatus(kind, status, restored)).toEqual(expected);
  });

  it.each([
    ['host.suspended', true],
    ['host.unsuspended', false],
    [undefined, false],
  ])(
    'a latest host action of %s leaves it suspended: %s',
    (action, expected) => {
      expect(leavesSuspended(action)).toBe(expected);
    },
  );
});

describe('pauseRefusal', () => {
  it.each(experienceStatuses)('pausing from %s', (status) => {
    expect(pauseRefusal(status, 'pause', false)).toEqual(
      pausable.includes(status) ? null : { status: 'not_live' },
    );
  });

  it.each(experienceStatuses)('unpausing from %s', (status) => {
    expect(pauseRefusal(status, 'unpause', false)).toEqual(
      status === 'paused' ? null : { status: 'not_paused' },
    );
  });

  it('refuses an unpause while the host is suspended, but not a pause, and checks the status first', () => {
    expect(pauseRefusal('paused', 'unpause', true)).toEqual({
      status: 'unpause_host_suspended',
    });
    expect(pauseRefusal('live', 'pause', true)).toBeNull();
    expect(pauseRefusal('guide_only', 'pause', true)).toBeNull();
    expect(pauseRefusal('live', 'unpause', true)).toEqual({
      status: 'not_paused',
    });
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

// Every pause code, so a code added to the list fails to compile here until it is covered.
const pauseCodes = {
  paused: true,
  unpaused: true,
  not_live: true,
  not_paused: true,
  unpause_host_suspended: true,
  suspended: true,
  unsuspended: true,
  nothing_to_suspend: true,
  nothing_to_unsuspend: true,
} as const satisfies Record<PauseNoticeCode, true>;

describe('the notices', () => {
  it.each(Object.keys(pauseCodes) as PauseNoticeCode[])(
    'has a notice for %s, read from an address',
    (code) => {
      expect(pauseNoticeFor(code)?.title).toBeTruthy();
      expect(pauseNoticeOf(code)).toEqual(pauseNoticeFor(code));
    },
  );

  it.each(['unpaused', 'unsuspended'] as const)(
    'says %s restored, not live, since a guide entry comes back as one',
    (code) => {
      expect(pauseNoticeFor(code)?.title).toMatch(/restored/);
      expect(pauseNoticeFor(code)?.title).not.toMatch(/live/);
    },
  );

  it('has none for no code', () => {
    expect(pauseNoticeFor(null)).toBeNull();
    expect(pauseNoticeOf('nonsense')).toBeNull();
  });

  it.each([
    ['host', hostNoticeCodes],
    ['experience', experienceNoticeCodes],
    ['photo', Object.keys(photoNotices)],
    ['review', reviewNoticeCodes],
  ])('shares no code with the %s notices', (_name, codes) => {
    expect(codes.filter((code) => code in pauseCodes)).toEqual([]);
  });

  it('reads a host notice before a pause one on the host page, and a pause one on the experience page', () => {
    expect(hostPageNotice('updated')?.title).toBe('Host saved.');
    expect(hostPageNotice('suspended')).toEqual(pauseNoticeFor('suspended'));
    expect(hostPageNotice('nonsense')).toBeNull();
    expect(experiencePageNotice('paused').notice).toEqual(
      pauseNoticeFor('paused'),
    );
    expect(experiencePageNotice('updated').notice?.title).toBe(
      'Experience saved.',
    );
    expect(pauseNoticeOf(['paused', 'unpaused'])).toBeNull();
  });
});

describe('the host suspension text', () => {
  it('labels the two buttons and the suspended state', () => {
    expect(suspensionActionLabel('pause')).toBe('Suspend host');
    expect(suspensionActionLabel('unpause')).toBe('Unsuspend host');
    expect(hostSuspendedText).toBe('This host is suspended.');
  });
});

describe('the action text', () => {
  it.each([
    ['pause', 'Pause experience', /hides this experience/],
    ['unpause', 'Unpause experience', /puts it back as it was/],
  ] as const)('for %s', (kind, label, explainer) => {
    expect(pauseActionLabel(kind)).toBe(label);
    expect(pauseExplainerText(kind)).toMatch(explainer);
  });
});

describe('the suspension sentences', () => {
  it.each([
    [0, /none of this host experiences.*records the suspension/],
    [1, /pauses 1 experience that guests can see.*stop seeing and booking it/],
    [4, /pauses 4 experiences that guests can see.*booking them/],
  ])('say what suspending does with %s visible', (count, expected) => {
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
    ['pause', 'experience.paused', 'guide_only', 'paused', false],
    ['unpause', 'experience.unpaused', 'paused', 'guide_only', true],
  ] as const)(
    'an experience %s',
    (kind, action, from, to, viaHostSuspension) => {
      const entry = experiencePauseEntry(
        id(1),
        id(2),
        kind,
        viaHostSuspension,
        { from, to },
      );

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
