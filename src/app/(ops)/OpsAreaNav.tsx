import { OpsNav } from '@/components/OpsShell';
import { holdsOpsRole, opsNavLinks } from '@/lib/opsNav';
import { readOpsCaller } from '@/server/opsCaller';

/**
 * The ops nav, for the ops role only. It is not a gate: the mailbox is also open to a tester
 * holding the shared secret off production, so every page checks its own access.
 */
export async function OpsAreaNav() {
  const caller = await readOpsCaller();
  return holdsOpsRole(caller.roles) ? <OpsNav links={opsNavLinks} /> : null;
}
