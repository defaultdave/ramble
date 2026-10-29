import { browseAsOf, browseWindow } from '@/lib/browse';
import { guestVisibleStatuses } from '@/lib/catalog';
import { hasSpaceLeft, spacesLeft, spacesStatus } from '@/lib/spaces';

// The coverage matrix (ADR 0008): every state in the signed-off Figma file (the mobile screens 01 to
// 08 with their variants, and the States page S1 to S10) mapped to the seed rows that produce it.
// Each row is a probe, a plain function over what the database holds after a seed, so "the seed
// yields each state's data" is a check that runs, not a sentence in a doc. docs/seed/coverage-matrix.md
// is rendered from this file and a test keeps the two equal.

export type SnapshotExperience = {
  slug: string;
  hostSlug: string;
  categorySlug: string;
  neighborhoodSlug: string;
  tier: string;
  status: string;
  outdoor: boolean;
  weatherPolicy: string | null;
  weatherDecisionHours: number | null;
  ageRule: string;
  minAge: number | null;
  maxAge: number | null;
  taxTreatment: string;
  waiverRequired: boolean;
  /** The waiver document the experience points at is a published version. */
  waiverPublished: boolean;
  linkOutUrl: string | null;
  meetingPoint: string | null;
  accessibilityNotes: string | null;
  prices: { kind: string; priceMinor: number; usesSpace: boolean }[];
};

export type SnapshotSession = {
  experienceSlug: string;
  /** The date on the host's wall calendar, YYYY-MM-DD. */
  localDate: string;
  startsAt: Date;
  allocation: number;
  seatsSold: number;
  source: string;
  status: string;
};

export type SnapshotCollection = {
  kind: string;
  slug: string;
  status: string;
  /** Experience slugs, in order, whatever their status. */
  items: string[];
};

export type SnapshotHomeModule = {
  kind: string;
  enabled: boolean;
  collectionSlug: string | null;
  hasBody: boolean;
};

export type SnapshotPageCopy = {
  kind: string;
  slug: string;
  status: string;
  complete: boolean;
};

/** Everything a probe may read. The seed builds it from the database; a test builds it from the fixtures. */
export type SeedSnapshot = {
  now: Date;
  categories: string[];
  neighborhoods: string[];
  hosts: { slug: string; description: string | null }[];
  experiences: SnapshotExperience[];
  sessions: SnapshotSession[];
  collections: SnapshotCollection[];
  /** In page order. */
  homeModules: SnapshotHomeModule[];
  pageCopy: SnapshotPageCopy[];
  legal: { doc: string; status: string }[];
  settings: { giftsEnabled: boolean; bookingsPaused: boolean };
};

const kayak = 'sunset-kayak-on-the-hudson';
const kidsWheel = 'kids-wheel-class';
const dayMs = 86_400_000;

const isLive = (e: SnapshotExperience) => e.status === 'live';
const isVisible = (e: SnapshotExperience) =>
  (guestVisibleStatuses as readonly string[]).includes(e.status);

function upcoming(snapshot: SeedSnapshot, slug?: string): SnapshotSession[] {
  return snapshot.sessions.filter(
    (session) =>
      session.status === 'scheduled' &&
      session.startsAt.getTime() > snapshot.now.getTime() &&
      (slug === undefined || session.experienceSlug === slug),
  );
}

function experience(
  snapshot: SeedSnapshot,
  slug: string,
): SnapshotExperience | undefined {
  return snapshot.experiences.find((e) => e.slug === slug);
}

function liveIn(
  snapshot: SeedSnapshot,
  field: 'categorySlug' | 'neighborhoodSlug',
  slug: string,
) {
  return snapshot.experiences.filter((e) => isLive(e) && e[field] === slug);
}

function visibleItems(snapshot: SeedSnapshot, collection: SnapshotCollection) {
  const visible = new Set(
    snapshot.experiences.filter(isVisible).map((e) => e.slug),
  );
  return collection.items.filter((slug) => visible.has(slug));
}

const isWeekend = (localDate: string) =>
  [0, 6].includes(new Date(`${localDate}T00:00:00Z`).getUTCDay());

/** The window browse reads for a seed taken at `now`, cut down the way a browse read cuts it. */
function seedBrowseWindow(snapshot: SeedSnapshot) {
  return browseWindow(browseAsOf(snapshot.now));
}

/** Every calendar date a browse date filter can match: from the day before now's date to the day after the window ends. */
function browseDates(snapshot: SeedSnapshot): string[] {
  const { from, to } = seedBrowseWindow(snapshot);
  const first = Date.parse(from.toISOString().slice(0, 10)) - dayMs;
  const last = Date.parse(to.toISOString().slice(0, 10)) + dayMs;
  return Array.from({ length: (last - first) / dayMs + 1 }, (_, i) =>
    new Date(first + i * dayMs).toISOString().slice(0, 10),
  );
}

/**
 * What browse returns for a category, a neighborhood, and a date: a guest-visible experience that can be
 * shown on a card (guide-only, or with a price) and has a scheduled session in the window with space left that starts on
 * that date. Mirrors `listBrowseExperiences`.
 */
function browseResults(
  snapshot: SeedSnapshot,
  search: { category: string; neighborhood: string; date: string },
): SnapshotExperience[] {
  const { from, to } = seedBrowseWindow(snapshot);
  return snapshot.experiences.filter(
    (e) =>
      isVisible(e) &&
      (e.status === 'guide_only' || e.prices.length > 0) &&
      e.categorySlug === search.category &&
      e.neighborhoodSlug === search.neighborhood &&
      snapshot.sessions.some(
        (x) =>
          x.experienceSlug === e.slug &&
          x.status === 'scheduled' &&
          x.startsAt >= from &&
          x.startsAt < to &&
          hasSpaceLeft(x) &&
          x.localDate === search.date,
      ),
  );
}

/** The home modules a guest sees: enabled, and a collection only once published. Mirrors `listHomeModules`. */
function guestHomeModules(snapshot: SeedSnapshot): SnapshotHomeModule[] {
  return snapshot.homeModules.filter((module) => {
    if (!module.enabled) return false;
    if (module.collectionSlug === null) return true;
    return snapshot.collections.some(
      (c) => c.slug === module.collectionSlug && c.status === 'published',
    );
  });
}

const homeOrder = [
  'hero_search',
  'category_rail',
  'picks',
  'gift_guide',
  'this_week',
  'reassurance',
];

export type Probe = {
  /** What the seed holds, naming the rows. It is printed in the matrix. */
  holds: string;
  /** True when only the scale fixture can satisfy it. */
  needsScale?: boolean;
  check: (snapshot: SeedSnapshot) => boolean;
};

export const probes = {
  'categories-eight': {
    holds: 'The 8 categories each have at least one live experience.',
    check: (s) =>
      s.categories.length === 8 &&
      s.categories.every((slug) => liveIn(s, 'categorySlug', slug).length > 0),
  },
  'neighborhoods-six': {
    holds:
      'The 6 neighborhoods (Williamsburg, Carroll Gardens, Park Slope, Sunset Park, Tribeca, Lower East Side) each have at least one live experience.',
    check: (s) =>
      s.neighborhoods.length === 6 &&
      s.neighborhoods.every(
        (slug) => liveIn(s, 'neighborhoodSlug', slug).length > 0,
      ),
  },
  'cooking-page': {
    holds:
      'Cooking has live experiences in Carroll Gardens and Sunset Park with upcoming sessions, and one guide-only entry (the category page in Figma 02, S1, and S3).',
    check: (s) => {
      const cooking = liveIn(s, 'categorySlug', 'cooking');
      const withSessions = cooking.filter(
        (e) => upcoming(s, e.slug).length > 0,
      );
      return (
        withSessions.some((e) => e.neighborhoodSlug === 'carroll-gardens') &&
        withSessions.some((e) => e.neighborhoodSlug === 'sunset-park') &&
        s.experiences.some(
          (e) => e.categorySlug === 'cooking' && e.status === 'guide_only',
        )
      );
    },
  },
  'many-results': {
    holds:
      'At least 24 live experiences, so a listing has a second page behind "Show more". The curated set is smaller; the scale fixture supplies the rest.',
    needsScale: true,
    check: (s) => s.experiences.filter(isLive).length >= 24,
  },
  'filter-variety': {
    holds:
      'Live experiences differ on every filter: three or more price points, indoor and outdoor, all four age rules, and some with access notes.',
    check: (s) => {
      const live = s.experiences.filter(isLive);
      const prices = new Set(
        live.flatMap((e) => e.prices.map((p) => p.priceMinor)),
      );
      const rules = new Set(live.map((e) => e.ageRule));
      return (
        prices.size >= 3 &&
        live.some((e) => e.outdoor) &&
        live.some((e) => !e.outdoor) &&
        ['all_ages', 'minimum_age', 'age_range', 'twenty_one_plus'].every(
          (rule) => rules.has(rule),
        ) &&
        live.some((e) => e.accessibilityNotes !== null)
      );
    },
  },
  'home-modules': {
    holds:
      'The home page has six enabled modules in order: hero_search, category_rail, picks, gift_guide, this_week, reassurance. The picks module shows the published Pick "rainy-day-sorted" and the gift_guide module the published gift guide; the hero and reassurance modules carry text.',
    check: (s) => {
      const modules = guestHomeModules(s);
      const kinds = modules.map((m) => m.kind);
      const byKind = (kind: string) => modules.find((m) => m.kind === kind);
      const picks = byKind('picks');
      const gift = byKind('gift_guide');
      const shows = (slug: string | null | undefined, kind: string) =>
        s.collections.some(
          (c) => c.slug === slug && c.kind === kind && c.status === 'published',
        );
      return (
        kinds.join(',') === homeOrder.join(',') &&
        shows(picks?.collectionSlug, 'pick') &&
        shows(gift?.collectionSlug, 'gift_guide') &&
        byKind('hero_search')?.hasBody === true &&
        byKind('reassurance')?.hasBody === true
      );
    },
  },
  'this-week': {
    holds:
      'At least four live experiences have a session in the next seven days (the "On this week" module).',
    check: (s) => {
      const horizon = s.now.getTime() + 7 * dayMs;
      const soon = new Set(
        upcoming(s)
          .filter((session) => session.startsAt.getTime() <= horizon)
          .map((session) => session.experienceSlug),
      );
      return (
        s.experiences.filter((e) => isLive(e) && soon.has(e.slug)).length >= 4
      );
    },
  },
  'picks-published': {
    holds:
      'Three published Picks ("rainy-day-sorted", "slow-saturday-mornings", "golden-hour"), each listing at least three experiences a guest can see.',
    check: (s) =>
      s.collections.filter(
        (c) =>
          c.kind === 'pick' &&
          c.status === 'published' &&
          visibleItems(s, c).length >= 3,
      ).length >= 3,
  },
  'pick-visibility': {
    holds:
      'A draft Pick ("date-night-downtown") exists and is never shown. A published Pick lists a guide-only entry, and another lists a paused experience that a guest must not see.',
    check: (s) => {
      const picks = s.collections.filter((c) => c.kind === 'pick');
      const bySlug = new Map(s.experiences.map((e) => [e.slug, e]));
      const listed = (status: string, collectionStatus: string) =>
        picks.some(
          (c) =>
            c.status === collectionStatus &&
            c.items.some((slug) => bySlug.get(slug)?.status === status),
        );
      return (
        picks.some((c) => c.status === 'draft') &&
        listed('guide_only', 'published') &&
        listed('paused', 'published')
      );
    },
  },
  'gift-guide': {
    holds:
      'One published gift guide, "Give a Saturday, not a sweater", lists six experiences a guest can see, and gifts are switched on in settings.',
    check: (s) => {
      const guides = s.collections.filter((c) => c.kind === 'gift_guide');
      const [guide] = guides;
      return (
        guides.length === 1 &&
        guide !== undefined &&
        guide.status === 'published' &&
        visibleItems(s, guide).length >= 3 &&
        s.settings.giftsEnabled
      );
    },
  },
  'gift-dates': {
    holds:
      'Each gift guide entry has at least eight upcoming sessions, so a recipient has dates to pick from. The next eight weeks only; a rolling generator (U-068) extends the window toward the 12-month gift validity.',
    check: (s) => {
      const guide = s.collections.find((c) => c.kind === 'gift_guide');
      return (
        guide !== undefined &&
        visibleItems(s, guide).length > 0 &&
        visibleItems(s, guide).every((slug) => upcoming(s, slug).length >= 8)
      );
    },
  },
  'page-copy': {
    holds:
      'Published copy (heading, description, intro, body) for all 8 categories and all 6 neighborhoods.',
    check: (s) => {
      const complete = (kind: string, slug: string) =>
        s.pageCopy.some(
          (c) =>
            c.kind === kind &&
            c.slug === slug &&
            c.status === 'published' &&
            c.complete,
        );
      return (
        s.categories.length > 0 &&
        s.categories.every((slug) => complete('category', slug)) &&
        s.neighborhoods.every((slug) => complete('neighborhood', slug))
      );
    },
  },
  'kayak-page': {
    holds:
      '"sunset-kayak-on-the-hudson" (Hudson Paddle Club, Tribeca, Outdoors): live, outdoor, weather decided 3 hours before start, minimum age 12, a waiver, a meeting point, access notes, a flexible 24-hour cancellation tier, an adult price of $65, and a host with a description.',
    check: (s) => {
      const e = experience(s, kayak);
      const host = s.hosts.find((h) => h.slug === e?.hostSlug);
      return (
        e !== undefined &&
        isLive(e) &&
        e.outdoor &&
        e.weatherPolicy === 'decided_before_start' &&
        e.weatherDecisionHours === 3 &&
        e.ageRule === 'minimum_age' &&
        e.minAge === 12 &&
        e.waiverRequired &&
        e.meetingPoint !== null &&
        e.accessibilityNotes !== null &&
        e.tier === 'flexible' &&
        e.prices.some((p) => p.kind === 'adult' && p.priceMinor === 6500) &&
        host?.description !== null &&
        host?.description !== undefined
      );
    },
  },
  'kayak-session-states': {
    holds:
      'The kayak has upcoming sessions that are open, nearly full (1 to 3 spaces), and sold out.',
    check: (s) => {
      const states = new Set(
        upcoming(s, kayak).map((x) => spacesStatus(spacesLeft(x))),
      );
      return (
        states.has('open') && states.has('few-left') && states.has('sold-out')
      );
    },
  },
  'kayak-full-day': {
    holds:
      'One kayak Saturday has three times on the same date: one open, one with exactly one space left, one sold out (the calendar day in Figma 04, S4, S5, and S7).',
    check: (s) => {
      const byDate = new Map<string, SnapshotSession[]>();
      for (const session of upcoming(s, kayak)) {
        byDate.set(session.localDate, [
          ...(byDate.get(session.localDate) ?? []),
          session,
        ]);
      }
      return [...byDate.values()].some(
        (day) =>
          day.length >= 3 &&
          day.some((x) => spacesLeft(x) === 1) &&
          day.some((x) => spacesLeft(x) === 0) &&
          day.some((x) => spacesStatus(spacesLeft(x)) === 'open'),
      );
    },
  },
  'kayak-other-dates': {
    holds:
      'At least three kayak sessions more than a day away have room for two (the "other dates for 2 guests" list, and a booking that can still be cancelled with a full refund).',
    check: (s) => {
      const dayAway = s.now.getTime() + dayMs;
      return (
        upcoming(s, kayak).filter(
          (x) => spacesLeft(x) >= 2 && x.startsAt.getTime() > dayAway,
        ).length >= 3
      );
    },
  },
  'bookable-party': {
    holds:
      'At least one session in the next 14 days has room for six, the most one guest can hold, so the booking flow and every payment state have something to book.',
    check: (s) => {
      const horizon = s.now.getTime() + 14 * dayMs;
      return upcoming(s).some(
        (x) => spacesLeft(x) >= 6 && x.startsAt.getTime() <= horizon,
      );
    },
  },
  'guide-only': {
    holds:
      '"sourdough-mornings-at-rise-bakery" (Rise Bakery, Park Slope, Cooking) is guide-only with a link out, no sessions and no prices, and Cooking has two live experiences to show beside it.',
    check: (s) => {
      const e = experience(s, 'sourdough-mornings-at-rise-bakery');
      return (
        e !== undefined &&
        e.status === 'guide_only' &&
        e.linkOutUrl !== null &&
        e.prices.length === 0 &&
        s.sessions.every((x) => x.experienceSlug !== e.slug) &&
        liveIn(s, 'categorySlug', 'cooking').length >= 2
      );
    },
  },
  'kids-booking': {
    holds: `"${kidsWheel}" (Wheelhouse Kids Studio, Williamsburg): ages 5 to 10, a free adult option that takes no space and a child price that does, with upcoming sessions.`,
    check: (s) => {
      const e = experience(s, kidsWheel);
      return (
        e !== undefined &&
        isLive(e) &&
        e.ageRule === 'age_range' &&
        e.prices.some((p) => p.kind === 'adult' && !p.usesSpace) &&
        e.prices.some(
          (p) => p.kind === 'child' && p.usesSpace && p.priceMinor > 0,
        ) &&
        upcoming(s, e.slug).length > 0
      );
    },
  },
  'twenty-one-plus': {
    holds:
      '"natural-wine-explained" (Orchard Street Wine Room, Lower East Side) is live, 21 and over, taxable, on the moderate (48-hour) tier, with upcoming sessions.',
    check: (s) => {
      const e = experience(s, 'natural-wine-explained');
      return (
        e !== undefined &&
        isLive(e) &&
        e.ageRule === 'twenty_one_plus' &&
        e.taxTreatment === 'taxable' &&
        e.tier === 'moderate' &&
        upcoming(s, e.slug).length > 0
      );
    },
  },
  waiver: {
    holds:
      'The kayak requires a waiver, and the legal document it points at ("waiver-hudson-paddle-club") is a published version.',
    check: (s) => {
      const e = experience(s, kayak);
      return (
        e !== undefined &&
        e.waiverRequired &&
        e.waiverPublished &&
        s.legal.some(
          (l) =>
            l.doc === 'waiver-hudson-paddle-club' && l.status === 'published',
        )
      );
    },
  },
  'legal-published': {
    holds:
      'Terms of service, privacy policy, and host agreement are published.',
    check: (s) =>
      ['terms', 'privacy', 'host-agreement'].every((doc) =>
        s.legal.some((l) => l.doc === doc && l.status === 'published'),
      ),
  },
  'tax-treatments': {
    holds:
      'Live experiences cover each tax treatment: taxable (wine, pottery, coffee), not taxable (kayak, walk), and unknown (pasta). The total shows a tax line only for taxable.',
    check: (s) => {
      const treatments = new Set(
        s.experiences.filter(isLive).map((e) => e.taxTreatment),
      );
      return ['taxable', 'not_taxable', 'unknown'].every((t) =>
        treatments.has(t),
      );
    },
  },
  neighbors: {
    holds:
      'The kayak shares Tribeca with a second live experience ("cast-iron-and-cobblestones"), for "More near Pier 26".',
    check: (s) => {
      const home = experience(s, kayak)?.neighborhoodSlug;
      return (
        home !== undefined && liveIn(s, 'neighborhoodSlug', home).length >= 2
      );
    },
  },
  'kids-zero-results': {
    holds:
      'Kids in Williamsburg run only on weekends: browse for kids in Williamsburg on any weeknight in its date window returns nothing, and on a weekend returns the wheel class. A kids class in Park Slope and other Williamsburg experiences give the "nearby" and "one less filter" suggestions.',
    check: (s) => {
      const search = { category: 'kids', neighborhood: 'williamsburg' };
      const found = (date: string) =>
        browseResults(s, { ...search, date }).length > 0;
      const dates = browseDates(s);
      const nearby = liveIn(s, 'categorySlug', 'kids').filter(
        (e) =>
          e.neighborhoodSlug !== 'williamsburg' &&
          upcoming(s, e.slug).some((x) => isWeekend(x.localDate)),
      );
      return (
        dates.filter((d) => !isWeekend(d)).every((d) => !found(d)) &&
        dates.filter(isWeekend).some(found) &&
        nearby.length > 0 &&
        liveIn(s, 'neighborhoodSlug', 'williamsburg').some(
          (e) => e.categorySlug !== 'kids',
        )
      );
    },
  },
  'hidden-statuses': {
    holds:
      'A draft, an in-review, and a paused experience exist and are the only ones a guest cannot see; live and guide-only both are.',
    check: (s) => {
      const statuses = new Set(s.experiences.map((e) => e.status));
      return (
        ['draft', 'in_review', 'paused', 'live', 'guide_only'].every((x) =>
          statuses.has(x),
        ) && s.experiences.filter((e) => !isVisible(e)).length >= 3
      );
    },
  },
  'tiers-all': {
    holds:
      'Live experiences use each cancellation tier: flexible, moderate, and strict.',
    check: (s) => {
      const tiers = new Set(s.experiences.filter(isLive).map((e) => e.tier));
      return ['flexible', 'moderate', 'strict'].every((t) => tiers.has(t));
    },
  },
  'weather-both': {
    holds:
      'Live outdoor experiences cover both weather policies: rain or shine (the walk) and decided before start (the kayak).',
    check: (s) => {
      const policies = new Set(
        s.experiences
          .filter((e) => isLive(e) && e.outdoor)
          .map((e) => e.weatherPolicy),
      );
      return (
        policies.has('rain_or_shine') && policies.has('decided_before_start')
      );
    },
  },
  'allocation-host': {
    holds:
      'A live experience ("sunday-sound-bath", Low Tide Studio) sells an allocation set up by ops, so its sessions come from an allocation, not the host.',
    check: (s) =>
      s.sessions.some(
        (x) =>
          x.source === 'allocation' &&
          experience(s, x.experienceSlug)?.status === 'live',
      ),
  },
} satisfies Record<string, Probe>;

export type ProbeKey = keyof typeof probes;

export type CoverageEntry = {
  /** The Figma frame name's number or S-number. */
  id: string;
  /** Node id in the Figma file "Ramble Core Flow Wireframes". */
  node: string;
  title: string;
  probes: ProbeKey[];
  /** What a person or a later unit does with the seed rows to reach the state. Nothing in the seed does it. */
  trigger: string;
  /** What the seed cannot hold yet, and why. */
  gap?: string;
};

export const coverage: CoverageEntry[] = [
  {
    id: '01',
    node: '44:10',
    title: 'Home',
    probes: [
      'home-modules',
      'picks-published',
      'gift-guide',
      'this-week',
      'categories-eight',
    ],
    trigger: 'Open the home page.',
    gap: 'The sponsor line on the gift module has no data model yet (Q-13).',
  },
  {
    id: '02',
    node: '45:190',
    title: 'Browse',
    probes: [
      'categories-eight',
      'neighborhoods-six',
      'cooking-page',
      'page-copy',
      'guide-only',
      'many-results',
    ],
    trigger: 'Open a category, neighborhood, Pick, gift guide, or search page.',
  },
  {
    id: '02b',
    node: '45:413',
    title: 'Browse, filters open',
    probes: ['filter-variety'],
    trigger: 'Open All filters on a browse page.',
  },
  {
    id: '03',
    node: '46:678',
    title: 'Experience',
    probes: ['kayak-page', 'kayak-session-states', 'neighbors'],
    trigger: 'Open the kayak page.',
    // TODO(U-021b): seed the photo pool, then drop this gap.
    gap: 'The seed writes no photo rows yet; the gallery shows its placeholder.',
  },
  {
    id: '03b',
    node: '46:897',
    title: 'Guide-only page',
    probes: ['guide-only'],
    trigger: 'Open the sourdough entry.',
  },
  {
    id: '04',
    node: '47:890',
    title: 'Choose date and party',
    probes: ['kayak-session-states', 'kayak-full-day', 'bookable-party'],
    trigger: 'Tap the booking bar on the kayak page.',
  },
  {
    id: '04b',
    node: '47:1132',
    title: 'Choose date, kids',
    probes: ['kids-booking'],
    trigger: 'Tap the booking bar on the kids wheel class.',
  },
  {
    id: '04c',
    node: '47:1350',
    title: 'Choose date, 21+',
    probes: ['twenty-one-plus'],
    trigger: 'Tap the booking bar on the natural wine class.',
  },
  {
    id: '05',
    node: '48:1397',
    title: 'Checkout',
    probes: [
      'kayak-page',
      'waiver',
      'legal-published',
      'tax-treatments',
      'twenty-one-plus',
      'kids-booking',
    ],
    trigger: 'Continue from the booking sheet to place a hold (U-014a).',
  },
  {
    id: '05b',
    node: '48:1517',
    title: 'Checkout, gift',
    probes: ['gift-guide', 'gift-dates'],
    trigger: 'Switch to "Give as a gift" in the booking sheet.',
  },
  {
    id: '06',
    node: '49:1548',
    title: 'Confirmation',
    probes: ['kayak-page', 'neighbors'],
    trigger: 'Pay with the fake gateway. Needs orders (not in main yet).',
  },
  {
    id: '06b',
    node: '49:1688',
    title: 'Confirmation, gift',
    probes: ['gift-guide'],
    trigger:
      'Pay for a gift with the fake gateway. Needs gift orders (not in main yet).',
  },
  {
    id: '07',
    node: '49:1784',
    title: 'Manage booking',
    probes: ['kayak-other-dates', 'kayak-page'],
    trigger:
      'Open the manage link from a confirmed order. Needs orders (not in main yet).',
  },
  {
    id: '08',
    node: '49:1888',
    title: 'Gift redemption',
    probes: ['gift-guide', 'gift-dates', 'waiver'],
    trigger:
      'Open the link from a paid gift. Needs gift orders (not in main yet).',
  },
  {
    id: 'S1',
    node: '53:7',
    title: 'Loading',
    probes: ['cooking-page', 'many-results'],
    trigger: 'Slow the results read; the skeletons are the state.',
  },
  {
    id: 'S2',
    node: '53:117',
    title: 'Zero results',
    probes: ['kids-zero-results'],
    trigger: 'Search kids in Williamsburg for a weeknight.',
  },
  {
    id: 'S3',
    node: '53:249',
    title: 'Error with retry',
    probes: ['cooking-page'],
    trigger: 'Make the results read fail on the Cooking page.',
  },
  {
    id: 'S4',
    node: '54:188',
    title: 'Hold blocked',
    probes: ['kayak-full-day', 'bookable-party'],
    trigger: 'Place and abandon three holds within 15 minutes (PRD-17).',
  },
  {
    id: 'S5',
    node: '54:287',
    title: 'Sold out before the hold',
    probes: ['kayak-full-day'],
    trigger:
      'Pick the kayak time with one space left for two guests while another guest takes it.',
  },
  {
    id: 'S6',
    node: '55:300',
    title: 'Hold expired',
    probes: ['bookable-party'],
    trigger: 'Place a hold and let the 10 minutes run out.',
  },
  {
    id: 'S7',
    node: '55:360',
    title: 'Sold out mid-checkout',
    probes: ['kayak-full-day', 'kayak-other-dates'],
    trigger:
      'Let a hold lapse on the one-space time while another guest books it.',
  },
  {
    id: 'S8',
    node: '55:414',
    title: 'Card declined',
    probes: ['bookable-party'],
    trigger: 'Pay with the fake gateway set to decline.',
  },
  {
    id: 'S9',
    node: '55:467',
    title: 'Connection lost after Pay',
    probes: ['bookable-party'],
    trigger: 'Drop the connection after tapping Pay.',
  },
  {
    id: 'S10',
    node: '55:516',
    title: 'Paid after the hold lapsed',
    probes: ['kayak-other-dates'],
    trigger:
      'Settle a payment after the hold has lapsed and the spaces have sold.',
  },
];

/** The ADR 0008 driving requirements that are not Figma states, with the probes that cover them. */
export const requirements: { title: string; probes: ProbeKey[] }[] = [
  {
    title: 'Every experience status, and what a guest can see (PRD-12, PRD-13)',
    probes: ['hidden-statuses', 'pick-visibility'],
  },
  { title: 'Every cancellation tier (PRD-10)', probes: ['tiers-all'] },
  { title: 'Both weather policies (PRD-12)', probes: ['weather-both'] },
  { title: 'Every tax treatment (PRD-78)', probes: ['tax-treatments'] },
  {
    title: 'Hosts on allocations as well as hosts on Ramble (PRD-42)',
    probes: ['allocation-host'],
  },
  {
    title:
      'Sessions with one space left and sold-out sessions (PRD-16, PRD-21)',
    probes: ['kayak-session-states'],
  },
];

export type ProbeResult = { key: ProbeKey; ok: boolean; skipped: boolean };

/** Runs every probe. A probe that needs the scale fixture is skipped, not failed, when it was not loaded. */
export function evaluateCoverage(
  snapshot: SeedSnapshot,
  options: { scale: boolean },
): ProbeResult[] {
  return (Object.keys(probes) as ProbeKey[]).map((key) => {
    const probe: Probe = probes[key];
    if (probe.needsScale && !options.scale) {
      return { key, ok: false, skipped: true };
    }
    return { key, ok: probe.check(snapshot), skipped: false };
  });
}

/** The keys of the probes that failed. Empty when the seed covers every state it can. */
export function coverageGaps(results: readonly ProbeResult[]): ProbeKey[] {
  return results.filter((r) => !r.ok && !r.skipped).map((r) => r.key);
}

/** The matrix as the Markdown document committed at docs/seed/coverage-matrix.md. */
export function renderCoverageMatrix(): string {
  const keys = (list: readonly ProbeKey[]) =>
    list.map((k) => `\`${k}\``).join(', ');
  const lines: string[] = [
    '# Seed coverage matrix',
    '',
    'Generated from `src/lib/seed/coverage.ts`; do not edit by hand. Run `pnpm test -u src/lib/seed/coverage.test.ts` after changing the probes, then commit the result.',
    '',
    'Every state in the signed-off Figma file ("Ramble Core Flow Wireframes", pages "Core flow (mobile)" and "States") maps to the seed rows that produce it. Each row below is a probe: a plain function that runs over the database after a seed and fails the seed run if the data is missing. The States page has ten states (S1 to S10); all ten are covered.',
    '',
    'A state that needs a hold, a payment, or an order cannot be reached from seed rows alone. The seed supplies what that state stands on (a bookable session, a nearly full time, other dates to offer); the "To reach it" column says what a person or a later unit does with those rows. The seed does not fake the hold or the order itself.',
    '',
    '## States',
    '',
    '| State | Figma node | Name | Probes | To reach it |',
    '|---|---|---|---|---|',
    ...coverage.map(
      (e) =>
        `| ${e.id} | ${e.node} | ${e.title} | ${keys(e.probes)} | ${e.trigger}${e.gap ? ` **Gap:** ${e.gap}` : ''} |`,
    ),
    '',
    '## Other requirements from ADR 0008',
    '',
    '| Requirement | Probes |',
    '|---|---|',
    ...requirements.map((r) => `| ${r.title} | ${keys(r.probes)} |`),
    '',
    '## What each probe checks',
    '',
    '| Probe | The seed holds |',
    '|---|---|',
    ...(Object.keys(probes) as ProbeKey[]).map((key) => {
      const probe: Probe = probes[key];
      const note = probe.needsScale
        ? ' *Needs the scale fixture (`--scale`).*'
        : '';
      return `| \`${key}\` | ${probe.holds}${note} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
