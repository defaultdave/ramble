import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { PrivateRequestInput } from '@/lib/privateSession';
import { guestVisible } from './catalog';
import type { Transaction } from './client';
import { experiences, privateRequests } from './schema';

/**
 * Writes one request in the caller's transaction, so it exists exactly when the notice queued with
 * it does. Throws, and writes nothing, when the experience is missing or not visible to guests:
 * a form for a page a guest cannot open was not made by a guest.
 */
export async function insertPrivateRequest(
  tx: Transaction,
  experienceId: string,
  input: PrivateRequestInput,
): Promise<{ id: string; createdAt: Date; experienceName: string }> {
  const [experience] = await tx
    .select({ name: experiences.name })
    .from(experiences)
    .where(and(eq(experiences.id, experienceId), guestVisible));
  if (!experience) throw new Error('The experience takes no private requests');

  const [row] = await tx
    .insert(privateRequests)
    .values({
      experienceId,
      requestedDate: input.date,
      groupSize: input.groupSize,
      budgetMinor: input.budgetMinor,
      name: input.name,
      email: input.email,
      message: input.message,
    })
    .returning({
      id: privateRequests.id,
      createdAt: privateRequests.createdAt,
    });
  if (!row) throw new Error('The private request was not written');
  return { ...row, experienceName: experience.name };
}
