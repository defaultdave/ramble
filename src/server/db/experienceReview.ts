import 'server-only';
import { eq } from 'drizzle-orm';
import {
  experienceApprovedEntry,
  experienceRejectedEntry,
} from '@/lib/experienceAudit';
import {
  decisionStatuses,
  reviewRefusal,
  type ReviewDecision,
  type ReviewRefusal,
} from '@/lib/experienceReview';
import { photoLimits } from '@/lib/photos';
import type { Caller } from '@/server/auth/caller';
import { requireOpsUserId, writeAudit } from './audit';
import { placeChanges } from './experienceEditor';
import { hostIsSuspended, withLockedExperience } from './lockedExperience';
import { coverOrder } from './photos';
import { experiences, photos } from './schema';

export type ReviewResult =
  { status: 'approved' | 'rejected' | 'not_found' } | ReviewRefusal;

/**
 * Approves an experience in review to live, or sends it back to draft with a reason's code. The
 * status check, the host check, the photo check, the status change and the audit row are one
 * transaction, on a locked row (the host's row first), so two ops users deciding at once cannot
 * both win and a host cannot be suspended between the check and the approval. An approval is
 * refused while the host is suspended, and one refused for a photo names the photos. An approval
 * makes the listing visible to guests, so its cache tags are invalidated after the commit; a
 * rejection leaves a listing guests never saw, so it invalidates nothing. Runs in a Server Action
 * only.
 */
export async function decideExperienceReview(
  caller: Caller,
  experienceId: string,
  decision: ReviewDecision,
): Promise<ReviewResult> {
  const userId = requireOpsUserId(caller);
  return await withLockedExperience<ReviewResult>(
    experienceId,
    { status: 'not_found' },
    async (tx, current) => {
      // The gallery in the order and to the length the page shows it, so a refusal's photo numbers
      // are the ones ops sees. The alt-text rule is also a CHECK on `photos`; this refusal is defence
      // in depth beyond that CHECK, for a row the CHECK did not guard.
      const gallery = await tx
        .select({ decorative: photos.decorative, altText: photos.altText })
        .from(photos)
        .where(eq(photos.experienceId, current.id))
        .orderBy(coverOrder)
        .limit(photoLimits.maxPerExperience);
      const refusal = reviewRefusal(
        current.status,
        decision,
        gallery,
        await hostIsSuspended(tx, current.hostId),
      );
      if (refusal) return { result: refusal, changes: [] };

      await tx
        .update(experiences)
        .set({ status: decisionStatuses[decision.kind] })
        .where(eq(experiences.id, current.id));
      if (decision.kind === 'reject') {
        await writeAudit(
          tx,
          experienceRejectedEntry(userId, current.id, decision.reason),
        );
        return { result: { status: 'rejected' }, changes: [] };
      }
      await writeAudit(tx, experienceApprovedEntry(userId, current.id));
      return {
        result: { status: 'approved' },
        changes: await placeChanges(tx, current),
      };
    },
  );
}
