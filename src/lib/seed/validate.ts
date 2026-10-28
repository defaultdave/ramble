import type { ZodError } from 'zod';
import { HostExperienceSchema, isSlug } from '@/lib/catalog';
import {
  CollectionInputSchema,
  HomeModulesInputSchema,
  PageCopyInputSchema,
  hasCollectionKindMismatch,
  isSingleCollection,
} from '@/lib/editorial';
import { LegalDraftInputSchema } from '@/lib/legal';
import { textOf } from './richText';
import { SessionTemplateInputSchema } from '@/lib/sessions';
import { SeedStepError } from './decide';
import { seedId } from './ids';
import { experienceRow, experienceId } from './rows';
import type {
  CuratedFixtures,
  ExperienceFixture,
  ScaleFixtures,
  SlotFixture,
} from './types';

// Every fixture is checked against the schemas the app itself uses (ADR 0008, DATA-4) before the
// seed writes anything, so a bad fixture stops the run instead of leaving half a catalog.

/** Words and marks the tone checklist (A10, "words to avoid") rules out of Ramble's own copy. */
const bannedWords = [
  'unforgettable',
  'curated adventures',
  'seamless',
  'hassle-free',
  'unlock',
  'elevate',
  'bucket list',
  'hidden gem',
  "book now before it's gone",
  'limited time',
  'oops',
  'successfully',
] as const;

/** The most spaces an occurrence index in a slot can name: eight weeks of one weekday, plus a day's slack. */
const maxOccurrenceIndex = 9;

function describe(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ');
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function uniqueIssues(label: string, values: readonly string[]): string[] {
  return duplicates(values).map((value) => `${label} "${value}" appears twice`);
}

const escapeForRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A banned word counts only as a whole word: "loops" does not contain "oops". Each pattern is a
// fixed literal between two single-character guards, so matching is linear in the text.
const bannedPatterns = bannedWords.map(
  (word) =>
    [word, new RegExp(`(^|[^a-z])${escapeForRegExp(word)}($|[^a-z])`)] as const,
);

function toneIssues(where: string, text: string): string[] {
  const lower = text.toLowerCase();
  const issues = bannedPatterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(
      ([word]) => `${where} uses "${word}", which the tone checklist rules out`,
    );
  if (text.includes('!')) issues.push(`${where} has an exclamation mark`);
  return issues;
}

function slotIssues(experience: ExperienceFixture): string[] {
  const issues: string[] = [];
  const slots: readonly SlotFixture[] = experience.slots;
  slots.forEach((slot) => {
    const where = `${experience.slug} slot ${String(slot.weekday)}@${slot.startTime}`;
    const parsed = SessionTemplateInputSchema.safeParse({
      experienceId: experienceId(experience.slug),
      weekday: slot.weekday,
      startTime: slot.startTime,
      durationMinutes: slot.durationMinutes,
      allocation: slot.allocation,
      source: slot.source ?? 'ramble',
    });
    if (!parsed.success) issues.push(`${where}: ${describe(parsed.error)}`);
    for (const leave of slot.leaves ?? []) {
      if (
        leave.spacesLeft < 0 ||
        leave.spacesLeft > slot.allocation ||
        leave.occurrence < 0 ||
        leave.occurrence > maxOccurrenceIndex
      ) {
        issues.push(
          `${where}: a leave names spaces or an occurrence out of range`,
        );
      }
    }
  });
  issues.push(
    ...uniqueIssues(
      `${experience.slug} slot`,
      slots.map((slot) => `${String(slot.weekday)}@${slot.startTime}`),
    ),
  );
  return issues;
}

function experienceIssues(
  experience: ExperienceFixture,
  legalDocs: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  if (!isSlug(experience.slug)) {
    issues.push(`experience "${experience.slug}" is not a slug`);
  }
  // Stand-in ids: the schema checks shape and rules, and the database supplies the real ones.
  const standIn = (namespace: string, key: string) =>
    new Map([[key, seedId(namespace, key)]]);
  const row = experienceRow(experience, {
    categories: standIn('category', experience.categorySlug),
    neighborhoods: standIn('neighborhood', experience.neighborhoodSlug),
    tiers: standIn('tier', experience.tier),
    waivers: experience.waiverDoc
      ? standIn('legal', experience.waiverDoc)
      : new Map(),
  });
  const parsed = HostExperienceSchema.safeParse({
    ...row,
    createdAt: new Date(0),
    priceOptions: experience.prices.map((price) => ({
      id: seedId('price', `${experience.slug}:${price.kind}`),
      experienceId: row.id,
      ...price,
    })),
    cancellationTier: {
      id: row.cancellationTierId,
      key: experience.tier,
      name: experience.tier,
      fullRefundHoursBefore: 24,
      isDefault: false,
    },
  });
  if (!parsed.success) {
    issues.push(`experience ${experience.slug}: ${describe(parsed.error)}`);
  }
  if (experience.waiverDoc !== null && !legalDocs.has(experience.waiverDoc)) {
    issues.push(
      `experience ${experience.slug} names the waiver "${experience.waiverDoc}", which no legal fixture holds`,
    );
  }
  issues.push(
    ...uniqueIssues(
      `${experience.slug} price kind`,
      experience.prices.map((price) => price.kind),
    ),
    ...slotIssues(experience),
  );
  return issues;
}

function copyIssues(
  curated: CuratedFixtures,
  experiences: readonly ExperienceFixture[],
  hostDescriptions: readonly string[],
): string[] {
  const texts: [string, string][] = [
    ...experiences.flatMap((experience): [string, string][] => [
      [`experience ${experience.slug} name`, experience.name],
      [
        `experience ${experience.slug} description`,
        experience.description ?? '',
      ],
      [`experience ${experience.slug} included`, experience.included ?? ''],
      [
        `experience ${experience.slug} access notes`,
        experience.accessibilityNotes ?? '',
      ],
      [
        `experience ${experience.slug} meeting point`,
        experience.meetingPoint ?? '',
      ],
    ]),
    ...hostDescriptions.map((text): [string, string] => [
      'host description',
      text,
    ]),
    ...curated.collections.flatMap((collection): [string, string][] => [
      [`collection ${collection.slug} title`, collection.title],
      [`collection ${collection.slug} summary`, collection.summary ?? ''],
      [
        `collection ${collection.slug} intro`,
        collection.intro ? textOf(collection.intro) : '',
      ],
      ...collection.items.map((item): [string, string] => [
        `collection ${collection.slug} note`,
        item.note ?? '',
      ]),
    ]),
    ...curated.homeModules.map((module): [string, string] => [
      `home module ${module.kind}`,
      `${module.heading ?? ''} ${module.body ? textOf(module.body) : ''}`,
    ]),
    ...curated.pageCopy.map((copy): [string, string] => [
      `${copy.kind} copy ${copy.slug}`,
      `${copy.heading} ${copy.metaDescription} ${textOf(copy.intro)} ${textOf(copy.body)}`,
    ]),
  ];
  return texts.flatMap(([where, text]) => toneIssues(where, text));
}

function editorialIssues(
  curated: CuratedFixtures,
  experienceSlugs: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];
  const collectionKinds = new Map<string, 'pick' | 'gift_guide'>();
  for (const collection of curated.collections) {
    collectionKinds.set(seedId('collection', collection.slug), collection.kind);
    const parsed = CollectionInputSchema.safeParse({
      ...collection,
      items: collection.items.map((item) => ({
        experienceId: experienceId(item.slug),
        note: item.note,
      })),
    });
    if (!parsed.success) {
      issues.push(`collection ${collection.slug}: ${describe(parsed.error)}`);
    }
    for (const item of collection.items) {
      if (!experienceSlugs.has(item.slug)) {
        issues.push(
          `collection ${collection.slug} lists "${item.slug}", which is not an experience`,
        );
      }
    }
  }
  const singles = curated.collections.filter((collection) =>
    isSingleCollection(collection.kind),
  );
  if (singles.length > 1) issues.push('there is more than one gift guide');

  const modules = curated.homeModules.map(({ collectionSlug, ...module }) => ({
    ...module,
    collectionId: collectionSlug ? seedId('collection', collectionSlug) : null,
  }));
  const parsedModules = HomeModulesInputSchema.safeParse(modules);
  if (!parsedModules.success) {
    issues.push(`home modules: ${describe(parsedModules.error)}`);
  }
  for (const { collectionSlug } of curated.homeModules) {
    if (
      collectionSlug &&
      !curated.collections.some((c) => c.slug === collectionSlug)
    ) {
      issues.push(
        `a home module shows "${collectionSlug}", which is not a collection`,
      );
    }
  }
  if (hasCollectionKindMismatch(modules, collectionKinds)) {
    issues.push('a home module shows a collection of the wrong kind');
  }

  for (const copy of curated.pageCopy) {
    const parsed = PageCopyInputSchema.safeParse({
      kind: copy.kind,
      targetId: seedId(copy.kind, copy.slug),
      heading: copy.heading,
      metaDescription: copy.metaDescription,
      intro: copy.intro,
      body: copy.body,
      status: 'published',
    });
    if (!parsed.success) {
      issues.push(`${copy.kind} copy ${copy.slug}: ${describe(parsed.error)}`);
    }
    const owners =
      copy.kind === 'category' ? curated.categories : curated.neighborhoods;
    if (!owners.some((owner) => owner.slug === copy.slug)) {
      issues.push(
        `${copy.kind} copy names "${copy.slug}", which is not a ${copy.kind}`,
      );
    }
  }
  for (const doc of curated.legal) {
    const parsed = LegalDraftInputSchema.safeParse(doc);
    if (!parsed.success)
      issues.push(`legal ${doc.doc}: ${describe(parsed.error)}`);
  }
  return issues;
}

/** Every problem in the fixtures, empty when they are sound. Curated and scale are checked together, so they cannot collide. */
export function fixtureIssues(
  curated: CuratedFixtures,
  scale?: ScaleFixtures,
): string[] {
  const experiences = [...curated.experiences, ...(scale?.experiences ?? [])];
  const hosts = [...curated.hosts, ...(scale?.hosts ?? [])];
  const experienceSlugs = new Set(experiences.map((e) => e.slug));
  const hostSlugs = new Set(hosts.map((h) => h.slug));
  const categorySlugs = new Set(curated.categories.map((c) => c.slug));
  const neighborhoodSlugs = new Set(curated.neighborhoods.map((n) => n.slug));
  const legalDocs = new Set(curated.legal.map((l) => l.doc));

  const issues: string[] = [
    ...uniqueIssues(
      'category',
      curated.categories.map((c) => c.slug),
    ),
    ...uniqueIssues(
      'neighborhood',
      curated.neighborhoods.map((n) => n.slug),
    ),
    ...uniqueIssues(
      'host',
      hosts.map((h) => h.slug),
    ),
    ...uniqueIssues(
      'experience',
      experiences.map((e) => e.slug),
    ),
    ...uniqueIssues(
      'legal document',
      curated.legal.map((l) => l.doc),
    ),
    ...uniqueIssues(
      'collection',
      curated.collections.map((c) => c.slug),
    ),
    ...uniqueIssues(
      'page copy',
      curated.pageCopy.map((c) => `${c.kind}:${c.slug}`),
    ),
  ];
  for (const slug of [...categorySlugs, ...neighborhoodSlugs, ...hostSlugs]) {
    if (!isSlug(slug)) issues.push(`"${slug}" is not a slug`);
  }
  for (const experience of experiences) {
    if (!hostSlugs.has(experience.hostSlug)) {
      issues.push(
        `experience ${experience.slug} names the host "${experience.hostSlug}", which does not exist`,
      );
    }
    if (!categorySlugs.has(experience.categorySlug)) {
      issues.push(
        `experience ${experience.slug} names the category "${experience.categorySlug}", which does not exist`,
      );
    }
    if (!neighborhoodSlugs.has(experience.neighborhoodSlug)) {
      issues.push(
        `experience ${experience.slug} names the neighborhood "${experience.neighborhoodSlug}", which does not exist`,
      );
    }
    issues.push(...experienceIssues(experience, legalDocs));
  }
  issues.push(
    ...editorialIssues(curated, experienceSlugs),
    ...copyIssues(
      curated,
      experiences,
      hosts.map((h) => h.description),
    ),
  );
  return issues;
}

/** Throws with the first problems when the fixtures are not sound. */
export function assertValidFixtures(
  curated: CuratedFixtures,
  scale?: ScaleFixtures,
): void {
  const issues = fixtureIssues(curated, scale);
  if (issues.length === 0) return;
  const shown = issues.slice(0, 10).join('\n  ');
  const more =
    issues.length > 10 ? `\n  and ${String(issues.length - 10)} more` : '';
  throw new SeedStepError(
    `The seed fixtures are not valid:\n  ${shown}${more}`,
  );
}
