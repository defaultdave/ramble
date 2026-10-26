/**
 * Vercel Hobby allows one firewall rate-limit rule, so the event and web-vitals beacons share a
 * path prefix and one rule covers both (ADR 0007). The rule lives in the Vercel dashboard or CLI,
 * not in `vercel.json`, which cannot express a rate limit; this module is the one definition of it.
 */
export const BEACON_PATH_PREFIX = '/api/beacon/';

export const beaconPaths = [
  '/api/beacon/events',
  '/api/beacon/vitals',
] as const;

export const beaconEdgeRule = {
  name: 'Beacon rate limit',
  description: 'Fixed-window cap per address on both beacons.',
  pathPrefix: BEACON_PATH_PREFIX,
  // A visitor sends one view and a few vitals per page; this leaves room for fast browsing.
  windowSeconds: 60,
  requests: 120,
  keys: 'ip',
  action: 'deny',
  durationMinutes: 5,
} as const;

/** The `vercel firewall rules add` command that creates the rule. Dave runs it; nothing here does. */
export function beaconEdgeRuleCommand(rule = beaconEdgeRule): string {
  const condition = JSON.stringify({
    type: 'path',
    op: 'pre',
    value: rule.pathPrefix,
  });
  return [
    `vercel firewall rules add '${rule.name}'`,
    `--description '${rule.description}'`,
    `--condition '${condition}'`,
    '--action rate_limit',
    `--rate-limit-window ${String(rule.windowSeconds)}`,
    `--rate-limit-requests ${String(rule.requests)}`,
    `--rate-limit-keys ${rule.keys}`,
    `--rate-limit-action ${rule.action}`,
    `--duration ${String(rule.durationMinutes)}m`,
  ].join(' \\\n  ');
}
