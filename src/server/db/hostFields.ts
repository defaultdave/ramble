import 'server-only';
import { eq } from 'drizzle-orm';
import { hostUpdatedEntry } from '@/lib/hostAudit';
import type { HostEditableField } from '@/lib/hostSetup';
import { requireRole, type Caller, type Role } from '@/server/auth/caller';
import { requireUserId, writeAudit } from './audit';
import type { Transaction } from './client';
import { hosts } from './schema';

export type HostRow = typeof hosts.$inferSelect;

/**
 * Saves `input` over a host's editable fields in the caller's transaction, with one audit row that
 * flags the fields `diff` finds changed. The caller is checked here, as `role` on this host (ops
 * for any, a host owner for their own), before anything is read or written. The row is locked and
 * read here; nothing differing writes nothing, audit row included. Null for a host that is gone,
 * else the fields that changed.
 */
export async function saveHostFields<Field extends HostEditableField>(
  tx: Transaction,
  caller: Caller,
  role: typeof Role.Ops | typeof Role.HostOwner,
  hostId: string,
  input: Pick<HostRow, Field>,
  diff: (current: HostRow) => Field[],
): Promise<Field[] | null> {
  requireRole(caller, role, { hostId });
  const userId = requireUserId(caller, role);
  const [current] = await tx
    .select()
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .for('update');
  if (!current) return null;
  const changed = diff(current);
  if (changed.length === 0) return changed;
  await tx.update(hosts).set(input).where(eq(hosts.id, hostId));
  await writeAudit(tx, hostUpdatedEntry(userId, hostId, changed));
  return changed;
}
