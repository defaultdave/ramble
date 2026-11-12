import { signInLinkTtlSeconds } from './auth';
import { ExportDaySchema, type AuditRow, type ExportDay } from './audit';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from './email/address';
import { formText, type FormGetter, type NoticeText } from './opsForm';
import type { GrantableRole, RoleGrant } from './roleGrants';
import { signInConfirmUrl } from './signIn';
import { isoDateOf } from './time';

// What the staff and audit pages decide: who may be invited, which grants may be taken back, what
// the notices say, and how a day of the audit log is asked for and shown.

export const staffPath = '/ops/staff';
export const auditPath = '/ops/audit';

/** Staff land on the ops area after signing in with the link. */
const staffLandingPath = '/ops';

/** The role an invite gives. Admin is granted only from the command line, where the person holds the database. */
export const invitedRole = 'ops' as const satisfies GrantableRole;

export const staffInviteField = 'email';

export type StaffInviteResult =
  'sent' | 'rate_limited' | 'failed' | 'not_found';
export type RevokeRefusal = 'self' | 'admin_role';

/** An address typed in the invite form, or null when it is missing, too long, or not an address. The length is checked first, so no rule walks an unbounded string. */
export function parseStaffEmail(get: FormGetter): string | null {
  const typed = formText(get, staffInviteField);
  if (typed === undefined || typed.length > maxEmailAddressLength) return null;
  const parsed = EmailAddressSchema.safeParse(normalizeEmailAddress(typed));
  return parsed.success ? parsed.data : null;
}

/** Whether ops may give this role. Admin is granted from the command line only, so ops cannot make admins. */
export function grantRefusal(grant: RoleGrant): 'admin_role' | null {
  return grant.role === 'admin' ? 'admin_role' : null;
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

/** The data of the sign-in email a new staff member gets: the same link every sign-in uses, landing on the ops area. */
export function staffLinkData(token: string, appOrigin: string) {
  return {
    url: signInConfirmUrl(appOrigin, token, staffLandingPath),
    expiresInMinutes: signInLinkTtlSeconds / 60,
  };
}

export const staffNoticeCodes = [
  'invited',
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
  invite_failed: {
    tone: 'danger',
    title: 'The sign-in link could not be sent. Try again in a moment.',
  },
  rate_limited: {
    tone: 'warning',
    title: 'Too many sign-in links went to this address. Try again later.',
  },
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
} as const satisfies Record<StaffInviteResult, StaffNoticeCode>;

export function staffInviteNotice(result: StaffInviteResult): StaffNoticeCode {
  return inviteNotices[result];
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
  role: GrantableRole;
};

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

const maxCursorDigits = 15;

/** The row id the address says to continue after, or 0 for the start of the day. Digits only, short enough to be a safe integer. */
export function parseAuditCursor(
  raw: string | readonly string[] | undefined,
): number {
  if (typeof raw !== 'string' || raw.length > maxCursorDigits) return 0;
  return /^[0-9]+$/.test(raw) ? Number(raw) : 0;
}

export type AuditViewRow = {
  id: string;
  time: string;
  actor: string;
  action: string;
  subject: string;
  details: string;
};

/** Details as `key: value` pairs; a row with none shows a dash. Values are ids and codes, never names or addresses. */
export function auditDetailsLabel(details: unknown): string {
  if (typeof details !== 'object' || details === null) return '—';
  const pairs = Object.entries(details).map(
    ([key, value]) => `${key}: ${String(value)}`,
  );
  return pairs.length === 0 ? '—' : pairs.join(', ');
}

/** One audit row as the viewer's table shows it, with the time in UTC. `id` is a string so the table can use it as a cursor. */
export function auditViewRow(row: AuditRow): AuditViewRow {
  return {
    id: String(row.id),
    time: `${row.recordedAt.toISOString().slice(11, 19)} UTC`,
    actor:
      row.actorId === null ? row.actorKind : `${row.actorKind} ${row.actorId}`,
    action: row.action,
    subject: `${row.subjectKind} ${row.subjectId}`,
    details: auditDetailsLabel(row.details),
  };
}
