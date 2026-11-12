import 'server-only';
import { eq } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import {
  experienceApprovedEntry,
  experienceRejectedEntry,
} from '@/lib/experienceAudit';
import { listingChanges } from '@/lib/experienceEditor';
import {
  decisionStatuses,
  reviewRefusal,
  type ReviewDecision,
  type ReviewRefusal,
} from '@/lib/experienceReview';
import type { CacheChange } from '@/lib/cacheTags';
import { photoLimits } from '@/lib/photos';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { requireOpsUserId, writeAudit } from './audit';
import { db } from './client';
import { placeSlugs } from './experienceEditor';
import { coverOrder } from './photos';
import { experiences, photos } from './schema';

export type ReviewResult =
  { status: 'approved' | 'rejected' | 'not_found' } | ReviewRefusal;

type Decided = { result: ReviewResult; changes: CacheChange[] };

/**
 * Approves an experience in review to live, or sends it back to draft with a reason's code. The
 * status check, the photo check, the status change and the audit row are one transaction, on a
 * locked row, so two ops users deciding at once cannot both win. An approval refused for a photo
 * names the photos. An approval makes the listing visible to guests, so its cache tags are
 * invalidated after the commit; a rejection leaves a listing guests never saw, so it invalidates
 * nothing. Runs in a Server Action only.
 */
export async function decideExperienceReview(
  caller: Caller,
  experienceId: string,
  decision: ReviewDecision,
): Promise<ReviewResult> {
  const userId = requireOpsUserId(caller);
  const parsedId = WriteIdSchema.safeParse(experienceId);
  if (!parsedId.success) return { status: 'not_found' };
  const id = parsedId.data;

  const decided = await db.transaction(async (tx): Promise<Decided> => {
    const [current] = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.id, id))
      .for('update');
    if (!current) return { result: { status: 'not_found' }, changes: [] };
    // The gallery in the order and to the length the page shows it, so a refusal's photo numbers
    // are the ones ops sees. The alt-text rule is also a CHECK on `photos`; this refusal is defence
    // in depth beyond that CHECK, for a row the CHECK did not guard.
    const gallery = await tx
      .select({ decorative: photos.decorative, altText: photos.altText })
      .from(photos)
      .where(eq(photos.experienceId, id))
      .orderBy(coverOrder)
      .limit(photoLimits.maxPerExperience);
    const refusal = reviewRefusal(current.status, decision, gallery);
    if (refusal) return { result: refusal, changes: [] };

    await tx
      .update(experiences)
      .set({ status: decisionStatuses[decision.kind] })
      .where(eq(experiences.id, id));
    if (decision.kind === 'reject') {
      await writeAudit(
        tx,
        experienceRejectedEntry(userId, id, decision.reason),
      );
      return { result: { status: 'rejected' }, changes: [] };
    }
    await writeAudit(tx, experienceApprovedEntry(userId, id));
    const place = await placeSlugs(tx, current);
    return {
      result: { status: 'approved' },
      changes: listingChanges(id, place, place),
    };
  });
  // After the commit, so a decision that rolled back invalidates nothing.
  updateTagsForChanges(decided.changes);
  return decided.result;
}
