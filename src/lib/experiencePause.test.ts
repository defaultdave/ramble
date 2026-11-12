import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { experienceStatuses } from './catalog';
import { experiencePauseEntry } from './experienceAudit';
import {
  pauseNoticeCodes,
  pauseNoticeFor,
  pauseRefusal,
  pauseTransitions,
} from './experiencePause';
import { hostSuspensionEntry } from './hostAudit';
import { id } from '../../tests/support/ids';

// Behaviours under test:
// - only a live experience can be paused and only a paused one unpaused; every other status is refused with the matching code
// - a pause leads to paused and an unpause to live
// - every notice code has a notice, and no code means no notice
// - the pause audit row names the user, the statuses and whether a host suspension did it, and the audit log accepts it
// - the host suspension audit row carries the count and no text, and the audit log accepts it

describe('pauseRefusal', () => {
  it.each(experienceStatuses)('pausing from %s', (status) => {
    expect(pauseRefusal(status, 'pause')).toEqual(
      status === 'live' ? null : { status: 'not_live' },
    );
  });

  it.each(experienceStatuses)('unpausing from %s', (status) => {
    expect(pauseRefusal(status, 'unpause')).toEqual(
      status === 'paused' ? null : { status: 'not_paused' },
    );
  });

  it('leads a pause to paused and an unpause to live', () => {
    expect(pauseTransitions.pause.to).toBe('paused');
    expect(pauseTransitions.unpause.to).toBe('live');
  });
});

describe('pauseNoticeFor', () => {
  it.each(pauseNoticeCodes)('has a notice for %s', (code) => {
    expect(pauseNoticeFor(code)?.title).toBeTruthy();
  });

  it('has none for no code', () => {
    expect(pauseNoticeFor(null)).toBeNull();
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
