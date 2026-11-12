import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  auditViewedEntry,
  roleGrantedEntry,
  roleRevokedEntry,
  staffLinkSentEntry,
  staffListedEntry,
} from './staffAudit';

// Behaviours under test: every staff audit entry is one the audit log accepts, names a signed-in
// user or the system as the actor, and carries ids and role names only.

const actor = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const subject = '2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const host = '3c3e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

describe('staff audit entries', () => {
  it.each([
    [
      'an ops user granting ops',
      roleGrantedEntry({ kind: 'user', userId: actor }, subject, {
        role: 'ops',
        hostId: null,
      }),
      { actorKind: 'user', actorId: actor, details: { role: 'ops' } },
    ],
    [
      'the system granting admin',
      roleGrantedEntry({ kind: 'system' }, subject, {
        role: 'admin',
        hostId: null,
      }),
      { actorKind: 'system', actorId: null, details: { role: 'admin' } },
    ],
    [
      'a host role names the host',
      roleGrantedEntry({ kind: 'user', userId: actor }, subject, {
        role: 'host_staff',
        hostId: host,
      }),
      {
        actorKind: 'user',
        actorId: actor,
        details: { role: 'host_staff', host_id: host },
      },
    ],
  ])('%s', (_name, entry, expected) => {
    expect(parseAuditEntry(entry)).toMatchObject({
      action: 'role.granted',
      subjectKind: 'auth_user',
      subjectId: subject,
      ...expected,
    });
  });

  it.each([
    [
      roleRevokedEntry(actor, subject, { role: 'ops', hostId: null }),
      'role.revoked',
      { role: 'ops' },
    ],
    [staffLinkSentEntry(actor, subject), 'staff.link_sent', {}],
    [staffListedEntry(actor), 'staff.list_viewed', {}],
    [
      auditViewedEntry(actor, '2026-11-11'),
      'audit.viewed',
      { day: '2026-11-11' },
    ],
  ])('%j is a user action %s', (entry, action, details) => {
    expect(parseAuditEntry(entry)).toMatchObject({
      actorKind: 'user',
      actorId: actor,
      action,
      details,
    });
  });
});
