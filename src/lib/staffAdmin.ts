import { z } from 'zod';
import {
  auditPatterns,
  ExportDaySchema,
  type AuditRow,
  type ExportDay,
} from './audit';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from './email/address';
import { formatMailboxTimestamp } from './email/message';
import { parseSingle } from './filters';
import {
  formText,
  inviteFailureNotices,
  type FormGetter,
  type InviteResult,
  type NoticeText,
} from './opsForm';
import type { GrantableRole, RoleGrant } from './roleGrants';
import { isoDateOf } from './time';

// What the staff and audit pages decide: who may be invited, which grants may be taken back, what
// the notices say, and how a day of the audit log is asked for and shown.

export const staffPath = '/ops/staff';
export const auditPath = '/ops/audit';

/** Staff land on the ops area after signing in with the link. */
export const staffLandingPath = '/ops';

/** The role an invite gives. Admin is granted only from the command line, where the person holds the database. */
export const invitedRole = 'ops' as const satisfies GrantableRole;

export const staffInviteField = 'email';

export type RevokeRefusal = 'self' | 'admin_role';

/** An address typed in the invite form, or null when it is missing, too long, or not an address. The length is checked first, so no rule walks an unbounded string. */
export function parseStaffEmail(get: FormGetter): string | null {
  const typed = formText(get, staffInviteField);
  if (typed === undefined || typed.length > maxEmailAddressLength) return null;
  const parsed = EmailAddressSchema.safeParse(normalizeEmailAddress(typed));
  return parsed.success ? parsed.data : null;
}

/**
 * Whether ops may take this grant back. A person cannot remove their own access, which could leave
 * nobody to sign in; admin is granted and removed from the command line only.
 */
export function revokeRefusal(
  actorUserId: string,
  userId: string,
  grant: RoleGrant,
): RevokeRefusal | null {
  if (grant.role === 'admin') return 'admin_role';
  if (actorUserId === userId) return 'self';
  return null;
}

export const staffNoticeCodes = [
  'invited',
  'granted_rate_limited',
  'granted_invite_failed',
  'invite_failed',
  'rate_limited',
  'invalid',
  'revoked',
  'revoke_self',
  'revoke_refused',
  'not_found',
] as const;
export type StaffNoticeCode = (typeof staffNoticeCodes)[number];

export const staffNotices = {
  invited: {
    tone: 'success',
    title: 'Staff access granted. A sign-in link is on its way.',
  },
  granted_rate_limited: {
    tone: 'warning',
    title:
      'Staff access granted, but too many sign-in links went to this address. Send the link again later.',
  },
  granted_invite_failed: {
    tone: 'warning',
    title:
      'Staff access granted, but the sign-in link could not be sent. Send it again below.',
  },
  ...inviteFailureNotices,
  invalid: {
    tone: 'danger',
    title: 'Enter the staff member’s email address, like name@example.com.',
  },
  revoked: { tone: 'success', title: 'Staff access removed.' },
  revoke_self: {
    tone: 'warning',
    title: 'You cannot remove your own access. Ask another staff member.',
  },
  revoke_refused: {
    tone: 'warning',
    title: 'Admin access is removed from the command line, not here.',
  },
  not_found: { tone: 'info', title: 'That staff member was not found.' },
} as const satisfies Record<StaffNoticeCode, NoticeText>;

const inviteNotices = {
  sent: 'invited',
  rate_limited: 'rate_limited',
  failed: 'invite_failed',
  not_found: 'not_found',
} as const satisfies Record<InviteResult, StaffNoticeCode>;

const grantedInviteNotices = {
  ...inviteNotices,
  rate_limited: 'granted_rate_limited',
  failed: 'granted_invite_failed',
} as const satisfies Record<InviteResult, StaffNoticeCode>;

/** What the person is told after a link was tried. After a fresh invite the grant already stands, so a refused link says so. */
export function staffInviteNotice(
  result: InviteResult,
  afterInvite: boolean,
): StaffNoticeCode {
  return (afterInvite ? grantedInviteNotices : inviteNotices)[result];
}

export function revokeNotice(
  outcome: 'revoked' | 'not_found' | RevokeRefusal,
): StaffNoticeCode {
  if (outcome === 'self') return 'revoke_self';
  if (outcome === 'admin_role') return 'revoke_refused';
  return outcome;
}

export const staffRoleLabels: Readonly<Record<GrantableRole, string>> = {
  ops: 'Ops',
  admin: 'Admin',
  host_owner: 'Host owner',
  host_staff: 'Host staff',
};

export type StaffRow = {
  userId: string;
  email: string;
  roles: readonly GrantableRole[];
};

/** One row per person from one row per grant, in the order each person is first met, so someone holding ops and admin is listed once. */
export function groupStaff(
  grants: readonly { userId: string; email: string; role: GrantableRole }[],
): StaffRow[] {
  const people = new Map<
    string,
    { userId: string; email: string; roles: GrantableRole[] }
  >();
  for (const grant of grants) {
    const person = people.get(grant.userId);
    if (person) person.roles.push(grant.role);
    else
      people.set(grant.userId, {
        userId: grant.userId,
        email: grant.email,
        roles: [grant.role],
      });
  }
  return [...people.values()];
}

/** The most staff rows one read returns; a team has a handful. */
export const staffReadLimit = 200;

// The audit viewer.

export const auditPageSize = 50;

/** The day the address names, or today (UTC) for none, a repeated one, or one that is not a real date. */
export function parseAuditDay(
  raw: string | readonly string[] | undefined,
  now: Date,
): ExportDay {
  const parsed =
    typeof raw === 'string' ? ExportDaySchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : isoDateOf(now);
}

const CursorSchema = z
  .string()
  .max(15)
  .regex(/^[0-9]+$/)
  .transform(Number);

/** The row id the address says to continue after, or 0 for the start of the day. Digits only, short enough to be a safe integer. */
export function parseAuditCursor(
  raw: string | readonly string[] | undefined,
): number {
  return parseSingle(raw, CursorSchema) ?? 0;
}

export type AuditViewRow = {
  id: string;
  time: string;
  actor: string;
  action: string;
  subject: string;
  details: string;
};

const detailValue = new RegExp(auditPatterns.detailValue);
const withheld = '[withheld]';

/**
 * Details as `key: value` pairs; a row with none shows a dash. The audit log refuses a name or an
 * address in a detail, and a string that is not an id or a code is withheld here too, so the
 * viewer cannot show free text whatever wrote the row.
 */
export function auditDetailsLabel(details: unknown): string {
  if (typeof details !== 'object' || details === null) return '—';
  const pairs = Object.entries(details).map(
    ([key, value]) =>
      `${key}: ${typeof value === 'string' && !detailValue.test(value) ? withheld : String(value)}`,
  );
  return pairs.length === 0 ? '—' : pairs.join(', ');
}

/** One audit row as the viewer's table shows it, with the time in UTC. `id` is a string so the table can use it as a cursor. */
export function auditViewRow(row: AuditRow): AuditViewRow {
  return {
    id: String(row.id),
    time: formatMailboxTimestamp(row.recordedAt),
    actor:
      row.actorId === null ? row.actorKind : `${row.actorKind} ${row.actorId}`,
    action: row.action,
    subject: `${row.subjectKind} ${row.subjectId}`,
    details: auditDetailsLabel(row.details),
  };
}
