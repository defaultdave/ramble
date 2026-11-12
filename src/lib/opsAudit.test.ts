import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  mailboxListEntry,
  mailboxMessageEntry,
  mailboxUnlockEntry,
  opsAccessEntry,
  opsAreaIds,
  opsAreaListEntry,
  opsViewEntry,
} from './opsAudit';

// Behaviours under test:
// - every entry passes the audit log's own validation, for a signed-in actor and for a guest
// - a signed-in actor is a user with their id; a tester with no session is a guest with none
// - each action names its subject: the area for the landing, list, and unlock; the message for a read
// - the way in (ops role or secret) is recorded for a list or a message read

const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const messageId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

describe('opsAreaListEntry', () => {
  it('is a valid entry naming the ops user and the area by its fixed id', () => {
    expect(
      parseAuditEntry(
        opsAreaListEntry(userId, 'support.list_viewed', opsAreaIds.support),
      ),
    ).toMatchObject({
      actorKind: 'user',
      actorId: userId,
      action: 'support.list_viewed',
      subjectKind: 'ops_area',
      subjectId: opsAreaIds.support,
    });
  });
});

describe('opsViewEntry', () => {
  it('is a valid entry naming the ops user and the record read by its id', () => {
    expect(
      parseAuditEntry(
        opsViewEntry(userId, 'session.viewed', 'session', messageId),
      ),
    ).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'session.viewed',
      subjectKind: 'session',
      subjectId: messageId,
      details: {},
    });
  });
});

describe('opsAccessEntry', () => {
  it('records the ops user opening the dashboard', () => {
    expect(parseAuditEntry(opsAccessEntry(userId))).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'ops.accessed',
      subjectKind: 'ops_area',
      subjectId: opsAreaIds.dashboard,
      details: { area: 'dashboard' },
    });
  });
});

describe('mailboxListEntry', () => {
  it.each([
    ['ops_role', userId, 'user', userId],
    ['secret', userId, 'user', userId],
    ['secret', null, 'guest', null],
  ] as const)(
    'records a list read through %s by %s',
    (via, caller, actorKind, actorId) => {
      expect(parseAuditEntry(mailboxListEntry(caller, via))).toEqual({
        actorKind,
        actorId,
        action: 'mailbox.listed',
        subjectKind: 'mailbox',
        subjectId: opsAreaIds.mailbox,
        details: { via },
      });
    },
  );
});

describe('mailboxMessageEntry', () => {
  it('records which message was read and how the reader got in', () => {
    expect(
      parseAuditEntry(mailboxMessageEntry(null, 'secret', messageId)),
    ).toEqual({
      actorKind: 'guest',
      actorId: null,
      action: 'mailbox.message_read',
      subjectKind: 'mailbox_message',
      subjectId: messageId,
      details: { via: 'secret' },
    });
  });
});

describe('mailboxUnlockEntry', () => {
  it('records the secret opening the mailbox', () => {
    expect(parseAuditEntry(mailboxUnlockEntry(userId))).toEqual({
      actorKind: 'user',
      actorId: userId,
      action: 'mailbox.unlocked',
      subjectKind: 'mailbox',
      subjectId: opsAreaIds.mailbox,
      details: { via: 'secret' },
    });
  });
});
