import 'server-only';
import { asc } from 'drizzle-orm';
import { CancellationTierSchema, type CancellationTier } from '@/lib/catalog';
import { dbRead } from './client';
import { cancellationTiers } from './schema';

// TODO(U-074b): first caller
/** Shortest notice first. Exactly one tier is the default. */
export async function listCancellationTiers(): Promise<CancellationTier[]> {
  const rows = await dbRead
    .select()
    .from(cancellationTiers)
    .orderBy(
      asc(cancellationTiers.fullRefundHoursBefore),
      asc(cancellationTiers.id),
    );
  return CancellationTierSchema.array().parse(rows);
}
