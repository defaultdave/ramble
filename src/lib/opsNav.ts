export type OpsNavLink = {
  label: string;
  href: string;
  /** One line for the landing page, which lists every area except itself. */
  summary: string;
};

/**
 * The ops areas that exist. A later unit adds its link here when it ships its page, so the nav
 * never points at a route that is not there.
 */
export const opsNavLinks: readonly OpsNavLink[] = [
  { label: 'Dashboard', href: '/ops', summary: 'Operations home.' },
  {
    label: 'Mailbox',
    href: '/ops/mailbox',
    summary:
      'Read the email captured on this deployment, including sign-in links.',
  },
  {
    label: 'Hosts',
    href: '/ops/hosts',
    summary: 'Set up hosts, invite their owners, and record the agreement.',
  },
  {
    label: 'Experiences',
    href: '/ops/experiences',
    summary: 'Find, add and edit experiences, with their prices and rules.',
  },
  {
    label: 'Support',
    href: '/ops/support',
    summary: 'Read guests’ messages, and mark each resolved with a note.',
  },
  {
    label: 'Review queue',
    href: '/ops/review',
    summary: 'Approve experiences waiting for review, or send them back.',
  },
  {
    label: 'Staff',
    href: '/ops/staff',
    summary: 'Invite Ramble staff and remove their access.',
  },
  {
    label: 'Audit log',
    href: '/ops/audit',
    summary: 'Read what was changed and who changed it, a day at a time.',
  },
];

/** The areas the landing page lists: every link but the landing page itself. */
export function opsLandingLinks(): readonly OpsNavLink[] {
  return opsNavLinks.filter((link) => link.href !== '/ops');
}

/** Whether a caller's roles include ops, the role the ops area is for. Admin is not enough. */
export function holdsOpsRole(roles: readonly string[]): boolean {
  return roles.includes('ops');
}
