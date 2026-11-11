import 'server-only';
import type { SupportRequestInput } from '@/lib/support';
import type { Transaction } from './client';
import { supportRequests } from './schema';

/** Writes one request in the caller's transaction, so it exists exactly when the notice queued with it does. */
export async function insertSupportRequest(
  tx: Transaction,
  input: SupportRequestInput,
): Promise<{ id: string; createdAt: Date }> {
  const [row] = await tx.insert(supportRequests).values(input).returning({
    id: supportRequests.id,
    createdAt: supportRequests.createdAt,
  });
  if (!row) throw new Error('The support request was not written');
  return row;
}
