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
];

/** The areas the landing page lists: every link but the landing page itself. */
export function opsLandingLinks(): readonly OpsNavLink[] {
  return opsNavLinks.filter((link) => link.href !== '/ops');
}

/** Whether a caller's roles include ops, the role the ops area is for. Admin is not enough. */
export function holdsOpsRole(roles: readonly string[]): boolean {
  return roles.includes('ops');
}
