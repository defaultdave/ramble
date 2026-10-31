import { EmailAddressSchema } from '@/lib/email/address';
import type {
  CollectionInput,
  HomeModulesInput,
  PageCopyInput,
} from '@/lib/editorial';
import { collectionTarget, lookup, SeedStepError } from './decide';
import { seedId } from './ids';
import { defaultTimeZone } from './plan';
import type {
  CollectionFixture,
  ExperienceFixture,
  HomeModuleFixture,
  HostFixture,
  PageCopyFixture,
  PriceFixture,
  SlotFixture,
  TaxonomyFixture,
} from './types';

// Fixture to row. Ids come from the slugs, so a fixture can point at another by name and a rerun
// writes the same ids. A row carries no `createdAt`: the column default stamps it on first insert
// and a rerun leaves it alone.

export const hostId = (slug: string) => seedId('host', slug);
export const experienceId = (slug: string) => seedId('experience', slug);

export function taxonomyRow(
  kind: 'category' | 'neighborhood',
  fixture: TaxonomyFixture,
) {
  return {
    id: seedId(kind, fixture.slug),
    slug: fixture.slug,
    name: fixture.name,
  };
}

/**
 * Where a seeded host's booking notices go. `.example` is reserved, so nothing reaches a real
 * inbox even with email live. An address the database CHECK would refuse stops the seed here.
 */
export function hostNotificationEmail(slug: string): string {
  const address = `bookings@${slug}.example`;
  if (!EmailAddressSchema.safeParse(address).success) {
    throw new SeedStepError(
      `Host "${slug}" cannot have a notification address: "${address}" is not a valid address`,
    );
  }
  return address;
}

export function hostRow(host: HostFixture) {
  return {
    id: hostId(host.slug),
    slug: host.slug,
    name: host.name,
    description: host.description,
    timeZone: host.timeZone ?? defaultTimeZone,
    notificationEmail: hostNotificationEmail(host.slug),
  };
}

/** What the database holds for the things a fixture points at, by slug or key. */
export type RefMaps = {
  categories: ReadonlyMap<string, string>;
  neighborhoods: ReadonlyMap<string, string>;
  tiers: ReadonlyMap<string, string>;
  /** Legal document key to the id of its published version. */
  waivers: ReadonlyMap<string, string>;
};

export function experienceRow(fixture: ExperienceFixture, refs: RefMaps) {
  return {
    id: experienceId(fixture.slug),
    hostId: hostId(fixture.hostSlug),
    categoryId: lookup(refs.categories, fixture.categorySlug, 'category'),
    neighborhoodId: lookup(
      refs.neighborhoods,
      fixture.neighborhoodSlug,
      'neighborhood',
    ),
    cancellationTierId: lookup(refs.tiers, fixture.tier, 'cancellation tier'),
    slug: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    meetingPoint: fixture.meetingPoint,
    included: fixture.included,
    durationMinutes: fixture.durationMinutes,
    accessibilityNotes: fixture.accessibilityNotes,
    status: fixture.status,
    outdoor: fixture.outdoor,
    weatherPolicy: fixture.weatherPolicy,
    weatherDecisionHours: fixture.weatherDecisionHours,
    ageRule: fixture.ageRule,
    minAge: fixture.minAge,
    maxAge: fixture.maxAge,
    taxTreatment: fixture.taxTreatment,
    waiverRequired: fixture.waiverDoc !== null,
    waiverDocumentId:
      fixture.waiverDoc === null
        ? null
        : lookup(refs.waivers, fixture.waiverDoc, 'published waiver'),
    linkOutUrl: fixture.linkOutUrl,
    affiliateUrl: fixture.affiliateUrl,
  };
}

function priceRow(experienceSlug: string, price: PriceFixture) {
  return {
    experienceId: experienceId(experienceSlug),
    kind: price.kind,
    priceMinor: price.priceMinor,
    usesSpace: price.usesSpace,
  };
}

export function priceRows(experiences: readonly ExperienceFixture[]) {
  return experiences.flatMap((experience) =>
    experience.prices.map((price) => priceRow(experience.slug, price)),
  );
}

/** The input `createSessionTemplate` takes for a slot. */
export function templateInput(experienceSlug: string, slot: SlotFixture) {
  return {
    experienceId: experienceId(experienceSlug),
    weekday: slot.weekday,
    startTime: slot.startTime,
    durationMinutes: slot.durationMinutes,
    allocation: slot.allocation,
    source: slot.source ?? ('ramble' as const),
  };
}

/** The input `saveCollection` takes: a replacement when the slug is already stored, a new collection otherwise. */
export function collectionInput(
  fixture: CollectionFixture,
  stored: readonly { id: string; slug: string; kind: string }[],
): CollectionInput {
  const target = collectionTarget(stored, fixture.slug, fixture.kind);
  if (target.action === 'conflict') {
    throw new SeedStepError(
      `Collection "${fixture.slug}" already exists as another kind, so the seed will not replace it`,
    );
  }
  return {
    ...(target.action === 'replace' ? { id: target.id } : {}),
    kind: fixture.kind,
    slug: fixture.slug,
    title: fixture.title,
    summary: fixture.summary,
    intro: fixture.intro,
    status: fixture.status,
    items: fixture.items.map((item) => ({
      experienceId: experienceId(item.slug),
      note: item.note,
    })),
  };
}

/** The whole home page as `saveHomeModules` takes it. `collectionIds` maps a collection slug to the id the database gave it. */
export function homeModulesInput(
  modules: readonly HomeModuleFixture[],
  collectionIds: ReadonlyMap<string, string>,
): HomeModulesInput {
  return modules.map(({ collectionSlug, ...module }) => ({
    ...module,
    collectionId:
      collectionSlug === null
        ? null
        : lookup(collectionIds, collectionSlug, 'saved collection'),
  }));
}

export function pageCopyInput(
  fixture: PageCopyFixture,
  refs: Pick<RefMaps, 'categories' | 'neighborhoods'>,
): PageCopyInput {
  const owners =
    fixture.kind === 'category' ? refs.categories : refs.neighborhoods;
  return {
    kind: fixture.kind,
    targetId: lookup(owners, fixture.slug, fixture.kind),
    heading: fixture.heading,
    metaDescription: fixture.metaDescription,
    intro: fixture.intro,
    body: fixture.body,
    status: 'published',
  };
}
