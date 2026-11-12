import 'server-only';
import { errorKind } from '@/lib/errorKind';
import { grantRoleUsage, parseGrantRoleArgs } from '@/lib/grantRoleArgs';
import { db } from '@/server/db/client';
import { ensureAuthUserIn, grantRoleIn } from '@/server/db/staffRoles';

export type GrantRoleCommand = {
  argv: readonly string[];
  write: (line: string) => void;
};

/**
 * The command that bootstraps the first account: makes the person's account if the address has
 * none, and gives the role once, with an audit row written by the system. It is the one grant made
 * without a signed-in caller, so it runs where the database is reachable and nowhere a request can
 * reach. Returns the process exit code: 0 done, 1 failed, 2 the arguments were refused.
 */
export async function runGrantRole(command: GrantRoleCommand): Promise<number> {
  const args = parseGrantRoleArgs(command.argv);
  if (args === null) {
    command.write(grantRoleUsage);
    return 2;
  }
  try {
    const outcome = await db.transaction(async (tx) => {
      const userId = await ensureAuthUserIn(tx, args.email);
      return grantRoleIn(tx, { kind: 'system' }, userId, args.grant);
    });
    command.write(
      outcome === 'granted'
        ? `Granted ${args.grant.role} to ${args.email}. They sign in with a link from /sign-in.`
        : `${args.email} already holds ${args.grant.role}. Nothing changed.`,
    );
    return 0;
  } catch (error) {
    command.write(`The role was not granted (${errorKind(error)}).`);
    return 1;
  }
}
