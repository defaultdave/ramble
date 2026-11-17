import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { getCurrentLegalDocument } from '@/server/db/legal';
import {
  experiences,
  guests,
  holdItems,
  holds,
  orderItems,
  orders,
  priceOptions,
  reviews,
  sessions,
} from '@/server/db/schema';
import { reviewFixtures } from '@/lib/seed/fixtures/reviews';
import { experienceId } from '@/lib/seed/rows';
import { pickSeedPrice, reviewSeedRows } from '@/lib/seed/reviews';
import { SeedStepError } from '@/lib/seed/decide';

// Writes the past bookings and reviews. No data-layer function creates an order from outside a
// hold, a payment, and a session still ahead, so the seed writes the rows directly, as it does for
// hosts and experiences, and the database CHECKs stand in for a write contract. Every row has a
// fixed id, so a rerun leaves the same rows and a reset (which wipes orders and reviews) puts them back.

async function readTermsDocumentId(): Promise<string> {
  const terms = await getCurrentLegalDocument('terms');
  if (!terms)
    throw new SeedStepError(
      'No published terms document for the past bookings',
    );
  return terms.id;
}

/** How many bookings and reviews were written. */
export async function seedReviews(
  caller: Caller,
  now: Date,
): Promise<{ bookings: number; reviews: number }> {
  requireRole(caller, Role.Ops, {});
  const termsDocumentId = await readTermsDocumentId();
  const slugs = [...new Set(reviewFixtures.map((f) => f.experienceSlug))];
  const experienceRows = await db
    .select({
      id: experiences.id,
      hostId: experiences.hostId,
      tierId: experiences.cancellationTierId,
    })
    .from(experiences)
    .where(inArray(experiences.id, slugs.map(experienceId)));
  const prices = await db
    .select({
      id: priceOptions.id,
      experienceId: priceOptions.experienceId,
      kind: priceOptions.kind,
      priceMinor: priceOptions.priceMinor,
      usesSpace: priceOptions.usesSpace,
    })
    .from(priceOptions)
    .where(inArray(priceOptions.experienceId, slugs.map(experienceId)))
    .orderBy(asc(priceOptions.kind), asc(priceOptions.priceMinor));

  let reviewCount = 0;
  for (const fixture of reviewFixtures) {
    const experience = experienceRows.find(
      (row) => row.id === experienceId(fixture.experienceSlug),
    );
    const price = pickSeedPrice(prices, experienceId(fixture.experienceSlug));
    if (!experience || !price) {
      throw new SeedStepError(
        `Review fixture "${fixture.key}" names an experience with no price: "${fixture.experienceSlug}"`,
      );
    }
    const rows = reviewSeedRows(fixture, price, now);
    const written = await db.transaction(async (tx) => {
      await tx
        .insert(guests)
        .values({ email: fixture.bookerEmail })
        .onConflictDoNothing({ target: guests.email });
      const [guest] = await tx
        .select({ id: guests.id })
        .from(guests)
        .where(eq(guests.email, fixture.bookerEmail));
      if (!guest) throw new SeedStepError(`No guest for "${fixture.key}"`);
      await tx
        .insert(sessions)
        .values({ ...rows.session, experienceId: experience.id })
        .onConflictDoUpdate({
          target: sessions.id,
          set: { seatsSold: rows.session.seatsSold },
        });
      await tx.insert(holds).values(rows.hold).onConflictDoNothing();
      await tx.insert(holdItems).values(rows.holdItem).onConflictDoNothing();
      await tx
        .insert(orders)
        .values({
          ...rows.order,
          hostId: experience.hostId,
          guestId: guest.id,
          termsDocumentId,
          cancellationTierId: experience.tierId,
        })
        .onConflictDoNothing();
      await tx.insert(orderItems).values(rows.orderItem).onConflictDoNothing();
      if (!rows.review) return 0;
      const inserted = await tx
        .insert(reviews)
        .values(rows.review)
        .onConflictDoNothing()
        .returning({ id: reviews.id });
      return inserted.length;
    });
    reviewCount += written;
  }
  return { bookings: reviewFixtures.length, reviews: reviewCount };
}
