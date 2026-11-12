import type { HostAccess } from './hostAccess';
import { ownedHostId } from './hostAccess';
import { hostExperiencesPath } from './hostExperiences';
import { hostSessionsPath } from './hostSessions';
import { hostSettingsPath } from './hostSettings';
import type { InviteResult, NoticeText } from './opsForm';
import type { RoleGrant } from './roleGrants';
import {
  staffInviteNotice,
  staffNoticeCodes,
  staffNotices,
  type StaffNoticeCode,
  type StaffRow,
} from './staffAdmin';

// What the host's staff page decides. A host owner gives and takes back one role, read-only staff,
// for their own host; the invite form, notices and mapper are the ones ops staff admin uses.

export const hostStaffPath = '/host/staff';

/** Staff land on the host area after signing in with the link. */
export const hostStaffLandingPath = '/host';

/** The one grant a host owner gives and takes back: read-only staff on their own host. */
export const hostStaffGrant = (hostId: string) =>
  ({ role: 'host_staff', hostId }) as const satisfies RoleGrant;

/** The most staff one host has. Under the staff read limit, so the page never hides one. */
export const maxHostStaff = 10;

export const hostStaffInviteHint =
  'Staff can see your dashboard, sessions and guest lists, and change nothing. They get a single-use sign-in link.';
export const hostStaffEmptyBody = 'Invite a staff member above.';

/** An invite that never reached the link: the host is at its cap, or its owner has sent too many. */
export type HostInviteResult =
  InviteResult | 'cap_reached' | 'too_many_invites';

export const hostStaffNoticeCodes = [
  ...staffNoticeCodes,
  'staff_cap',
  'invites_limited',
] as const;
export type HostStaffNoticeCode =
  StaffNoticeCode | 'staff_cap' | 'invites_limited';

export const hostStaffNotices = {
  ...staffNotices,
  staff_cap: {
    tone: 'warning',
    title: `A host can have ${String(maxHostStaff)} staff members. Remove one to invite another.`,
  },
  invites_limited: {
    tone: 'warning',
    title: 'Too many invitations just now. Try again later.',
  },
} as const satisfies Record<HostStaffNoticeCode, NoticeText>;

/** The notice for an invite or resend; `afterInvite` is as for ops staff. */
export function hostInviteNotice(
  result: HostInviteResult,
  afterInvite: boolean,
): HostStaffNoticeCode {
  if (result === 'cap_reached') return 'staff_cap';
  if (result === 'too_many_invites') return 'invites_limited';
  return staffInviteNotice(result, afterInvite);
}

export type HostNavLink = { label: string; href: string };

/** The host area's links: an owner manages the sessions, the staff and the host's own settings and sees its experiences; staff only look at the sessions. */
export function hostNavLinks(canManage: boolean): HostNavLink[] {
  return canManage
    ? [
        { label: 'Manage sessions', href: hostSessionsPath },
        { label: 'Your experiences', href: hostExperiencesPath },
        { label: 'Host settings', href: hostSettingsPath },
        { label: 'Staff', href: hostStaffPath },
      ]
    : [{ label: 'Sessions', href: hostSessionsPath }];
}

export type HostStaffResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; rows: readonly StaffRow[] };

/** Nobody signed in signs in; anyone who does not own a host, host staff included, is refused. `rows` is null when the caller was not allowed to read them. */
export function hostStaffResult(
  access: HostAccess,
  rows: readonly StaffRow[] | null,
): HostStaffResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (ownedHostId(access) === null || rows === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', rows };
}
