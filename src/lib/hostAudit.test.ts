import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  hostAgreementAcceptedEntry,
  hostCreatedEntry,
  hostFormEntry,
  hostListEntry,
  hostOwnerInviteEntry,
  hostUpdatedEntry,
  hostViewEntry,
} from './hostAudit';
import { opsAreaIds } from './opsAudit';

// Behaviours under test:
// - every host entry passes the audit log's own validation and names the ops user who acted
// - a list or form view names the hosts area; a host view, write, acceptance, or invite names the host
// - an update records which fields changed as flags, never their values
// - a write names the owner or the document by id, and no entry carries an address or a name

const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const hostId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const otherId = '7c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

describe('host audit entries', () => {
  it.each([
    [
      'the list',
      hostListEntry(userId),
      'host.list_viewed',
      'ops_area',
      opsAreaIds.hosts,
    ],
    [
      'the new-host form',
      hostFormEntry(userId),
      'host.form_viewed',
      'ops_area',
      opsAreaIds.hosts,
    ],
    ['one host', hostViewEntry(userId, hostId), 'host.viewed', 'host', hostId],
    [
      'a created host',
      hostCreatedEntry(userId, hostId, otherId),
      'host.created',
      'host',
      hostId,
    ],
    [
      'an update',
      hostUpdatedEntry(userId, hostId, ['name']),
      'host.updated',
      'host',
      hostId,
    ],
    [
      'an acceptance',
      hostAgreementAcceptedEntry(userId, hostId, otherId),
      'host.agreement_accepted',
      'host',
      hostId,
    ],
    [
      'an invite',
      hostOwnerInviteEntry(userId, hostId, otherId),
      'host.owner_invited',
      'host',
      hostId,
    ],
  ])(
    '%s passes validation and names the user and the subject',
    (_label, entry, action, kind, subject) => {
      expect(parseAuditEntry(entry)).toMatchObject({
        actorKind: 'user',
        actorId: userId,
        action,
        subjectKind: kind,
        subjectId: subject,
      });
    },
  );

  it('records an update as flags for the fields that changed', () => {
    expect(
      parseAuditEntry(
        hostUpdatedEntry(userId, hostId, [
          'name',
          'timeZone',
          'notificationEmail',
        ]),
      ).details,
    ).toEqual({
      changed_name: true,
      changed_time_zone: true,
      changed_notification_email: true,
    });
  });

  it('names the owner and the document by id', () => {
    expect(
      parseAuditEntry(hostCreatedEntry(userId, hostId, otherId)).details,
    ).toEqual({
      owner_user_id: otherId,
    });
    expect(
      parseAuditEntry(hostAgreementAcceptedEntry(userId, hostId, otherId))
        .details,
    ).toEqual({ legal_document_id: otherId });
  });
});
