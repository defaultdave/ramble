import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import type { HeldItem } from '@/lib/checkout';
import { buildCheckoutView, type CheckoutRead } from '@/lib/pages/checkoutPage';
import { MAX_LINES } from '@/lib/pricing';
import type { Device } from '@/server/device';
import { db } from './client';
import { getCurrentLegalDocument, getPublishedLegalDocument } from './legal';
import {
  cancellationTiers,
  experiences,
  holdItems,
  holds,
  hosts,
  neighborhoods,
  priceOptions,
  sessions,
} from './schema';
import { readHoldSettings } from './settings';
import { readDatabaseTime } from './time';

/**
 * The checkout page's read of one hold. The hold must be the calling device's, so another
 * device's hold, a missing one, a gift's, and one already paid or released all answer null (design
 * doc 4.2.3: a guessed id learns nothing). Guest device rows are checked against a `Device`, not
 * `requireRole` (architecture B6). One transaction reads the rows and the database clock together,
 * so the timer the page shows starts from the clock that decides the hold.
 */
export async function readCheckoutView(
  device: Device,
  holdId: string,
): Promise<CheckoutRead> {
  const id = EntityIdSchema.safeParse(holdId);
  if (!id.success) return null;

  const loaded = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        hold: holds,
        session: sessions,
        experience: {
          id: experiences.id,
          slug: experiences.slug,
          title: experiences.name,
          meetingPoint: experiences.meetingPoint,
          taxTreatment: experiences.taxTreatment,
          ageRule: experiences.ageRule,
          minAge: experiences.minAge,
          maxAge: experiences.maxAge,
          waiverRequired: experiences.waiverRequired,
          waiverDocumentId: experiences.waiverDocumentId,
        },
        hostName: hosts.name,
        neighborhoodName: neighborhoods.name,
        cancellationHoursBefore: cancellationTiers.fullRefundHoursBefore,
      })
      .from(holds)
      .innerJoin(sessions, eq(sessions.id, holds.sessionId))
      .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
      .innerJoin(hosts, eq(hosts.id, experiences.hostId))
      .innerJoin(
        neighborhoods,
        eq(neighborhoods.id, experiences.neighborhoodId),
      )
      .innerJoin(
        cancellationTiers,
        eq(cancellationTiers.id, experiences.cancellationTierId),
      )
      .where(eq(holds.id, id.data));
    if (!row) return null;
    const items: HeldItem[] = await tx
      .select({
        priceOptionId: holdItems.priceOptionId,
        kind: priceOptions.kind,
        quantity: holdItems.quantity,
        unitPriceMinor: holdItems.unitPriceMinor,
        usesSpace: holdItems.usesSpace,
      })
      .from(holdItems)
      .innerJoin(priceOptions, eq(priceOptions.id, holdItems.priceOptionId))
      .where(eq(holdItems.holdId, id.data))
      .orderBy(asc(priceOptions.kind))
      .limit(MAX_LINES + 1);
    const setting = await readHoldSettings(tx);
    return {
      row,
      items,
      taxRatePpm: setting.taxRatePpm,
      holdMinutes: setting.holdMinutes,
      at: await readDatabaseTime(tx),
    };
  });
  if (!loaded) return null;

  const { row } = loaded;
  const [terms, waiver] = await Promise.all([
    getCurrentLegalDocument('terms'),
    row.experience.waiverDocumentId === null
      ? null
      : getPublishedLegalDocument(row.experience.waiverDocumentId),
  ]);
  return buildCheckoutView(
    {
      hold: row.hold,
      session: row.session,
      experience: {
        ...row.experience,
        hostName: row.hostName,
        neighborhoodName: row.neighborhoodName,
        cancellationHoursBefore: row.cancellationHoursBefore,
      },
      items: loaded.items,
      taxRatePpm: loaded.taxRatePpm,
      holdMinutes: loaded.holdMinutes,
      terms: terms && { id: terms.id, doc: terms.doc },
      waiver: waiver && { id: waiver.id, doc: waiver.doc },
      at: loaded.at,
    },
    device.deviceKey,
  );
}
