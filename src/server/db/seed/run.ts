import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import {
  saveCollection,
  saveHomeModules,
  savePageCopy,
} from '@/server/db/editorial';
import { createLegalDraft, publishLegalDocument } from '@/server/db/legal';
import { createSessionTemplate, generateSessions } from '@/server/db/sessions';
import {
  cancellationTiers,
  categories,
  collections,
  experiences,
  hosts,
  legalDocuments,
  neighborhoods,
  priceOptions,
  sessionTemplates,
  sessions,
} from '@/server/db/schema';
import type { ScaleOptions } from '@/lib/seed/args';
import {
  expectOk,
  expectStatus,
  inChunks,
  legalSeedStep,
  seatUpdates,
  templateNotFound,
  templateOutcome,
} from '@/lib/seed/decide';
import { curated } from '@/lib/seed/fixtures';
import {
  groupPlanned,
  hasPlannedSeats,
  planSessions,
  seedSessionRange,
  storedStartTime,
} from '@/lib/seed/plan';
import {
  collectionInput,
  experienceId,
  experienceRow,
  homeModulesInput,
  hostRow,
  pageCopyInput,
  priceRows,
  taxonomyRow,
  templateInput,
  type RefMaps,
} from '@/lib/seed/rows';
import {
  curatedLine,
  editorialLine,
  legalLine,
  scaleLine,
  stepNames,
  taxonomyLine,
  type CatalogCounts,
} from '@/lib/seed/outcome';
import { generateScaleFixtures } from '@/lib/seed/scale';
import type { LegalFixture, ScaleFixtures } from '@/lib/seed/types';
import { assertValidFixtures } from '@/lib/seed/validate';

// Writes the seed. Where the data layer has a write contract the seed calls it, as ops: legal
// documents, collections, the home page, category and neighborhood copy, session templates, and
// session generation. Where it has none, the seed writes the schema directly, and the database
// CHECKs and the fixture validation stand in for the contract: categories, neighborhoods, hosts,
// experiences, price options, and the seats sold on the sessions the coverage matrix needs nearly
// full or sold out (seats sold otherwise move only with orders, which do not exist yet).

const experienceBatch = 50;
const rowBatch = 100;

const excluded = (column: string) => sql`excluded.${sql.identifier(column)}`;

export type SeedOptions = {
  /** Who the seed writes as. Anything but ops is refused before a row is written. */
  caller: Caller;
  /** The clock for session generation. The runner never reads one itself. */
  now: Date;
  scale?: ScaleOptions | undefined;
  log?: (line: string) => void;
};

export type SeedReport = {
  legalDocuments: number;
  collections: number;
  homeModules: number;
  pageCopy: number;
  curated: CatalogCounts;
  scale: CatalogCounts | undefined;
};

async function writeTaxonomy() {
  const { categoryRows, neighborhoodRows } = await db.transaction(
    async (tx) => ({
      categoryRows: await tx
        .insert(categories)
        .values(curated.categories.map((c) => taxonomyRow('category', c)))
        .onConflictDoUpdate({
          target: categories.slug,
          set: { name: excluded('name') },
        })
        .returning({ id: categories.id, slug: categories.slug }),
      neighborhoodRows: await tx
        .insert(neighborhoods)
        .values(
          curated.neighborhoods.map((n) => taxonomyRow('neighborhood', n)),
        )
        .onConflictDoUpdate({
          target: neighborhoods.slug,
          set: { name: excluded('name') },
        })
        .returning({ id: neighborhoods.id, slug: neighborhoods.slug }),
    }),
  );
  const tierRows = await db
    .select({ id: cancellationTiers.id, key: cancellationTiers.key })
    .from(cancellationTiers);
  return {
    categories: new Map(categoryRows.map((row) => [row.slug, row.id])),
    neighborhoods: new Map(neighborhoodRows.map((row) => [row.slug, row.id])),
    tiers: new Map(tierRows.map((row) => [row.key, row.id])),
  };
}

async function publishedWaivers(docs: readonly LegalFixture[]) {
  const ids = new Map<string, string>();
  for (const fixture of docs) {
    const [row] = await db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.doc, fixture.doc),
          eq(legalDocuments.status, 'published'),
        ),
      )
      .orderBy(desc(legalDocuments.version))
      .limit(1);
    if (row) ids.set(fixture.doc, row.id);
  }
  return ids;
}

async function writeLegal(caller: Caller, docs: readonly LegalFixture[]) {
  for (const fixture of docs) {
    const versions = await db
      .select({
        id: legalDocuments.id,
        version: legalDocuments.version,
        status: legalDocuments.status,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, fixture.doc))
      .limit(200);
    const step = legalSeedStep(versions);
    if (step.action === 'skip') continue;
    const id =
      step.action === 'publish'
        ? step.id
        : (
            await createLegalDraft(caller, {
              doc: fixture.doc,
              title: fixture.title,
              body: fixture.body,
            })
          ).id;
    expectStatus(
      stepNames.publishLegal(fixture.doc),
      await publishLegalDocument(caller, id),
      'published',
    );
  }
}

async function writeHostsAndExperiences(catalog: ScaleFixtures, refs: RefMaps) {
  await db.transaction(async (tx) => {
    for (const batch of inChunks(catalog.hosts, rowBatch)) {
      await tx
        .insert(hosts)
        .values(batch.map(hostRow))
        .onConflictDoUpdate({
          target: hosts.id,
          set: {
            name: excluded('name'),
            description: excluded('description'),
            timeZone: excluded('time_zone'),
            notificationEmail: excluded('notification_email'),
          },
        });
    }
    for (const batch of inChunks(catalog.experiences, experienceBatch)) {
      await tx
        .insert(experiences)
        .values(batch.map((fixture) => experienceRow(fixture, refs)))
        .onConflictDoUpdate({
          target: experiences.id,
          set: {
            hostId: excluded('host_id'),
            categoryId: excluded('category_id'),
            neighborhoodId: excluded('neighborhood_id'),
            cancellationTierId: excluded('cancellation_tier_id'),
            slug: excluded('slug'),
            name: excluded('name'),
            description: excluded('description'),
            meetingPoint: excluded('meeting_point'),
            included: excluded('included'),
            durationMinutes: excluded('duration_minutes'),
            accessibilityNotes: excluded('accessibility_notes'),
            status: excluded('status'),
            outdoor: excluded('outdoor'),
            weatherPolicy: excluded('weather_policy'),
            weatherDecisionHours: excluded('weather_decision_hours'),
            ageRule: excluded('age_rule'),
            minAge: excluded('min_age'),
            maxAge: excluded('max_age'),
            taxTreatment: excluded('tax_treatment'),
            waiverRequired: excluded('waiver_required'),
            waiverDocumentId: excluded('waiver_document_id'),
            linkOutUrl: excluded('link_out_url'),
            affiliateUrl: excluded('affiliate_url'),
          },
        });
      const prices = priceRows(batch);
      if (prices.length > 0) {
        await tx
          .insert(priceOptions)
          .values(prices)
          .onConflictDoUpdate({
            target: [priceOptions.experienceId, priceOptions.kind],
            set: {
              priceMinor: excluded('price_minor'),
              usesSpace: excluded('uses_space'),
            },
          });
      }
    }
  });
}

async function writeSessions(
  caller: Caller,
  catalog: ScaleFixtures,
  now: Date,
): Promise<
  Pick<
    CatalogCounts,
    'templates' | 'sessionsCreated' | 'sessionsAlreadyThere' | 'seatsAdjusted'
  >
> {
  const planned = groupPlanned(
    planSessions(catalog.hosts, catalog.experiences, now),
  );
  const range = seedSessionRange(now);
  const counts = {
    templates: 0,
    sessionsCreated: 0,
    sessionsAlreadyThere: 0,
    seatsAdjusted: 0,
  };
  for (const fixture of catalog.experiences) {
    for (const slot of fixture.slots) {
      templateOutcome(
        await createSessionTemplate(caller, templateInput(fixture.slug, slot)),
      );
      const [template] = await db
        .select({ id: sessionTemplates.id })
        .from(sessionTemplates)
        .where(
          and(
            eq(sessionTemplates.experienceId, experienceId(fixture.slug)),
            eq(sessionTemplates.weekday, slot.weekday),
            eq(sessionTemplates.startTime, storedStartTime(slot)),
          ),
        );
      if (!template) {
        throw templateNotFound(fixture.slug);
      }
      const generated = expectOk(
        stepNames.generateSessions,
        await generateSessions(
          caller,
          { templateId: template.id, ...range },
          now,
        ),
      );
      counts.templates += 1;
      counts.sessionsCreated += generated.created.length;
      counts.sessionsAlreadyThere += generated.alreadyExisted;
    }
    const plans = planned.get(fixture.slug) ?? [];
    if (!hasPlannedSeats(plans)) continue;
    const stored = await db
      .select({
        id: sessions.id,
        seatsSold: sessions.seatsSold,
        localDate: sessions.localDate,
        weekday: sessionTemplates.weekday,
        startTime: sessionTemplates.startTime,
      })
      .from(sessions)
      .innerJoin(sessionTemplates, eq(sessions.templateId, sessionTemplates.id))
      .where(eq(sessions.experienceId, experienceId(fixture.slug)))
      .limit(500);
    const updates = seatUpdates(plans, stored);
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(sessions)
          .set({ seatsSold: update.seatsSold })
          .where(eq(sessions.id, update.sessionId));
      }
    });
    counts.seatsAdjusted += updates.length;
  }
  return counts;
}

async function writeCatalog(
  caller: Caller,
  catalog: ScaleFixtures,
  refs: RefMaps,
  now: Date,
): Promise<CatalogCounts> {
  await writeHostsAndExperiences(catalog, refs);
  const sessionCounts = await writeSessions(caller, catalog, now);
  return {
    hosts: catalog.hosts.length,
    experiences: catalog.experiences.length,
    ...sessionCounts,
  };
}

async function writeEditorial(
  caller: Caller,
  refs: Pick<RefMaps, 'categories' | 'neighborhoods'>,
) {
  const stored = await db
    .select({
      id: collections.id,
      slug: collections.slug,
      kind: collections.kind,
    })
    .from(collections)
    .limit(200);
  const collectionIds = new Map<string, string>();
  for (const fixture of curated.collections) {
    const saved = expectStatus(
      stepNames.saveCollection(fixture.slug),
      await saveCollection(caller, collectionInput(fixture, stored)),
      'saved',
    );
    collectionIds.set(fixture.slug, saved.value.id);
  }
  expectStatus(
    stepNames.saveHomeModules,
    await saveHomeModules(
      caller,
      homeModulesInput(curated.homeModules, collectionIds),
    ),
    'saved',
  );
  for (const fixture of curated.pageCopy) {
    expectStatus(
      stepNames.savePageCopy(fixture.kind, fixture.slug),
      await savePageCopy(caller, pageCopyInput(fixture, refs)),
      'saved',
    );
  }
}

/**
 * Seeds the curated coverage set and, when asked, the scale fixture. Safe to run again: every row has
 * a fixed id or a unique key, and a repeat leaves the same rows. The caller has already checked
 * where it is pointed (`checkSeedTarget`); this function does not.
 */
export async function runSeed(options: SeedOptions): Promise<SeedReport> {
  requireRole(options.caller, Role.Ops, {});
  const { caller } = options;
  const log = options.log ?? (() => undefined);
  const scale = options.scale
    ? generateScaleFixtures(options.scale)
    : undefined;
  assertValidFixtures(curated, scale);

  const taxonomy = await writeTaxonomy();
  log(taxonomyLine(curated.categories.length, curated.neighborhoods.length));
  await writeLegal(caller, curated.legal);
  const waivers = await publishedWaivers(curated.legal);
  log(legalLine(curated.legal.length));
  const refs: RefMaps = { ...taxonomy, waivers };

  const curatedCounts = await writeCatalog(caller, curated, refs, options.now);
  log(curatedLine(curatedCounts));
  await writeEditorial(caller, refs);
  log(
    editorialLine(
      curated.collections.length,
      curated.homeModules.length,
      curated.pageCopy.length,
    ),
  );

  let scaleCounts: CatalogCounts | undefined;
  if (scale) {
    scaleCounts = await writeCatalog(caller, scale, refs, options.now);
    log(scaleLine(scaleCounts));
  }
  return {
    legalDocuments: curated.legal.length,
    collections: curated.collections.length,
    homeModules: curated.homeModules.length,
    pageCopy: curated.pageCopy.length,
    curated: curatedCounts,
    scale: scaleCounts,
  };
}
