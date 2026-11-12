import { z } from 'zod';
import { WriteIdSchema } from './catalog';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from './email/address';
import {
  grantableRoles,
  isValidGrantScope,
  type RoleGrant,
} from './roleGrants';

// The arguments of `pnpm db:grant-role`, which makes the first ops or admin account in a database
// that has not been seeded, and gives a role to anyone else whose address it is handed.

export const grantRoleUsage =
  'Usage: pnpm db:grant-role --email <address> --role <ops|admin|host_owner|host_staff> [--host <host id>]';

export type GrantRoleArgs = { email: string; grant: RoleGrant };

const maxArgumentLength = maxEmailAddressLength + 16;

const ArgsSchema = z.strictObject({
  email: z.string().transform(normalizeEmailAddress).pipe(EmailAddressSchema),
  role: z.enum(grantableRoles),
  host: WriteIdSchema.optional(),
});

/** `--name value` pairs, each name once. Anything else is refused, never guessed at. */
function pairsOf(argv: readonly string[]): Record<string, string> | null {
  if (argv.length % 2 !== 0) return null;
  const pairs = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 2) {
    const name = argv[at];
    const value = argv[at + 1];
    if (name === undefined || value === undefined) return null;
    if (!name.startsWith('--') || value.length > maxArgumentLength) return null;
    const key = name.slice(2);
    if (pairs.has(key)) return null;
    pairs.set(key, value);
  }
  // fromEntries makes an own property even for `__proto__`, which the strict schema then refuses.
  return Object.fromEntries(pairs);
}

/** The address and grant the arguments name, or null when they do not make a valid grant (a host role without a host, or ops or admin with one). */
export function parseGrantRoleArgs(
  argv: readonly string[],
): GrantRoleArgs | null {
  const pairs = pairsOf(argv);
  if (pairs === null) return null;
  const parsed = ArgsSchema.safeParse(pairs);
  if (!parsed.success) return null;
  const grant = { role: parsed.data.role, hostId: parsed.data.host ?? null };
  return isValidGrantScope(grant) ? { email: parsed.data.email, grant } : null;
}
