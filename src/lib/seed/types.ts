import type { CollectionInput, HomeModulesInput } from '@/lib/editorial';
import type {
  ageRules,
  experienceStatuses,
  priceKinds,
  taxTreatments,
  weatherPolicies,
} from '@/lib/catalog';
import type { RichTextDoc } from '@/lib/richText/format';

/** The three reference tiers a migration inserts. A fixture names one; the seed looks its id up. */
type TierKey = 'flexible' | 'moderate' | 'strict';

export type TaxonomyFixture = { slug: string; name: string };

export type HostFixture = {
  slug: string;
  name: string;
  description: string;
  /** Defaults to New York. */
  timeZone?: string;
};

export type PriceFixture = {
  kind: (typeof priceKinds)[number];
  priceMinor: number;
  usesSpace: boolean;
};

/**
 * A weekly slot. The seed turns it into a session template and generates the next weeks from it.
 * `leaves` rewrites how many spaces one generated session has left, counted from the first
 * upcoming date of the slot (0 is the first), so a fixture can have a sold-out or nearly full date.
 */
export type SlotFixture = {
  /** 0 is Sunday. */
  weekday: number;
  /** HH:MM on the host's wall clock. */
  startTime: string;
  durationMinutes: number;
  allocation: number;
  source?: 'ramble' | 'allocation';
  leaves?: { occurrence: number; spacesLeft: number }[];
};

export type ExperienceFixture = {
  slug: string;
  hostSlug: string;
  categorySlug: string;
  neighborhoodSlug: string;
  tier: TierKey;
  name: string;
  description: string | null;
  meetingPoint: string | null;
  included: string | null;
  durationMinutes: number | null;
  accessibilityNotes: string | null;
  status: (typeof experienceStatuses)[number];
  outdoor: boolean;
  weatherPolicy: (typeof weatherPolicies)[number] | null;
  weatherDecisionHours: number | null;
  ageRule: (typeof ageRules)[number];
  minAge: number | null;
  maxAge: number | null;
  taxTreatment: (typeof taxTreatments)[number];
  /** The legal document key of the host's waiver (`waiver-...`), or null when the host asks for none. */
  waiverDoc: string | null;
  linkOutUrl: string | null;
  affiliateUrl: string | null;
  prices: PriceFixture[];
  slots: SlotFixture[];
};

export type LegalFixture = {
  doc: string;
  title: string;
  body: RichTextDoc;
};

/** A collection whose entries are named by experience slug; the seed turns each into the experience's id. */
export type CollectionFixture = Omit<CollectionInput, 'id' | 'items'> & {
  items: { slug: string; note: string | null }[];
};

/** A home module that shows a collection names it by slug. */
export type HomeModuleFixture = Omit<
  HomeModulesInput[number],
  'collectionId'
> & { collectionSlug: string | null };

export type PageCopyFixture = {
  kind: 'category' | 'neighborhood';
  slug: string;
  heading: string;
  metaDescription: string;
  intro: RichTextDoc;
  body: RichTextDoc;
};

export type CuratedFixtures = {
  categories: TaxonomyFixture[];
  neighborhoods: TaxonomyFixture[];
  hosts: HostFixture[];
  experiences: ExperienceFixture[];
  legal: LegalFixture[];
  collections: CollectionFixture[];
  homeModules: HomeModuleFixture[];
  pageCopy: PageCopyFixture[];
};

export type ScaleFixtures = {
  hosts: HostFixture[];
  experiences: ExperienceFixture[];
};
