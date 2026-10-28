import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  cancellationTiers,
  categories,
  collectionItems,
  collections,
  experiences,
  homeModules,
  hosts,
  legalDocuments,
  neighborhoods,
  pages,
  priceOptions,
  sessions,
  settings,
} from '@/server/db/schema';
import type { SeedSnapshot } from '@/lib/seed/coverage';
import { assembleSnapshot } from '@/lib/seed/snapshot';

// Every read has a limit. They sit above the most the seed can write: 1000 scale experiences with
// three weekly slots over nine weeks is under 30,000 sessions.
const limits = {
  small: 500,
  experiences: 5_000,
  prices: 10_000,
  sessions: 60_000,
  items: 5_000,
} as const;

/**
 * What the seed left in the database, read straight from the tables and shaped for the coverage
 * probes. It reads every status, because the probes also check what a guest must not see.
 */
export async function readSeedSnapshot(now: Date): Promise<SeedSnapshot> {
  const categoryRows = await db
    .select({ slug: categories.slug })
    .from(categories)
    .limit(limits.small);
  const neighborhoodRows = await db
    .select({ slug: neighborhoods.slug })
    .from(neighborhoods)
    .limit(limits.small);
  const hostRows = await db
    .select({ slug: hosts.slug, description: hosts.description })
    .from(hosts)
    .limit(limits.experiences);
  const experienceRows = await db
    .select({
      slug: experiences.slug,
      hostSlug: hosts.slug,
      categorySlug: categories.slug,
      neighborhoodSlug: neighborhoods.slug,
      tier: cancellationTiers.key,
      status: experiences.status,
      outdoor: experiences.outdoor,
      weatherPolicy: experiences.weatherPolicy,
      weatherDecisionHours: experiences.weatherDecisionHours,
      ageRule: experiences.ageRule,
      minAge: experiences.minAge,
      maxAge: experiences.maxAge,
      taxTreatment: experiences.taxTreatment,
      waiverRequired: experiences.waiverRequired,
      waiverStatus: legalDocuments.status,
      linkOutUrl: experiences.linkOutUrl,
      meetingPoint: experiences.meetingPoint,
      accessibilityNotes: experiences.accessibilityNotes,
    })
    .from(experiences)
    .innerJoin(hosts, eq(experiences.hostId, hosts.id))
    .innerJoin(categories, eq(experiences.categoryId, categories.id))
    .innerJoin(neighborhoods, eq(experiences.neighborhoodId, neighborhoods.id))
    .innerJoin(
      cancellationTiers,
      eq(experiences.cancellationTierId, cancellationTiers.id),
    )
    .leftJoin(
      legalDocuments,
      eq(experiences.waiverDocumentId, legalDocuments.id),
    )
    .limit(limits.experiences);
  const priceRowsRead = await db
    .select({
      experienceSlug: experiences.slug,
      kind: priceOptions.kind,
      priceMinor: priceOptions.priceMinor,
      usesSpace: priceOptions.usesSpace,
    })
    .from(priceOptions)
    .innerJoin(experiences, eq(priceOptions.experienceId, experiences.id))
    .limit(limits.prices);
  const sessionRows = await db
    .select({
      experienceSlug: experiences.slug,
      localDate: sessions.localDate,
      startsAt: sessions.startsAt,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      source: sessions.source,
      status: sessions.status,
    })
    .from(sessions)
    .innerJoin(experiences, eq(sessions.experienceId, experiences.id))
    .limit(limits.sessions);
  const collectionRows = await db
    .select({
      id: collections.id,
      kind: collections.kind,
      slug: collections.slug,
      status: collections.status,
    })
    .from(collections)
    .limit(limits.small);
  const itemRows = await db
    .select({
      collectionId: collectionItems.collectionId,
      experienceSlug: experiences.slug,
      position: collectionItems.position,
    })
    .from(collectionItems)
    .innerJoin(experiences, eq(collectionItems.experienceId, experiences.id))
    .limit(limits.items);
  const moduleRows = await db
    .select({
      position: homeModules.position,
      kind: homeModules.kind,
      enabled: homeModules.enabled,
      collectionSlug: collections.slug,
      body: homeModules.body,
    })
    .from(homeModules)
    .leftJoin(collections, eq(homeModules.collectionId, collections.id))
    .limit(limits.small);
  const categoryCopy = await db
    .select({
      slug: categories.slug,
      status: pages.status,
      heading: pages.heading,
      metaDescription: pages.metaDescription,
      intro: pages.intro,
      body: pages.body,
    })
    .from(pages)
    .innerJoin(categories, eq(pages.categoryId, categories.id))
    .limit(limits.small);
  const neighborhoodCopy = await db
    .select({
      slug: neighborhoods.slug,
      status: pages.status,
      heading: pages.heading,
      metaDescription: pages.metaDescription,
      intro: pages.intro,
      body: pages.body,
    })
    .from(pages)
    .innerJoin(neighborhoods, eq(pages.neighborhoodId, neighborhoods.id))
    .limit(limits.small);
  const legalRows = await db
    .select({ doc: legalDocuments.doc, status: legalDocuments.status })
    .from(legalDocuments)
    .limit(limits.small);
  const [settingsRow] = await db
    .select({
      giftsEnabled: settings.giftsEnabled,
      bookingsPaused: settings.bookingsPaused,
    })
    .from(settings);
  if (!settingsRow) throw new Error('The settings row is missing');

  return assembleSnapshot(
    {
      categories: categoryRows,
      neighborhoods: neighborhoodRows,
      hosts: hostRows,
      experiences: experienceRows,
      prices: priceRowsRead,
      sessions: sessionRows,
      collections: collectionRows,
      collectionItems: itemRows,
      homeModules: moduleRows,
      pageCopy: [
        ...categoryCopy.map((copy) => ({ kind: 'category', ...copy })),
        ...neighborhoodCopy.map((copy) => ({ kind: 'neighborhood', ...copy })),
      ],
      legal: legalRows,
      settings: settingsRow,
    },
    now,
  );
}
