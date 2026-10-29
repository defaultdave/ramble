import { z } from 'zod';
import { EntityIdSchema, guestVisibleStatuses } from './catalog';
import type { Category, Neighborhood } from './catalog';
import type { Collection, HomeModule } from './editorial';
import {
  cardLookupLimit,
  cardsInOrder,
  type CardExperience,
  type ExperienceCard,
} from './experienceCards';
import { hrefForFilters, noFilters } from './filters';
import { withCovers, type PhotoView } from './photoViews';
import type { RichTextDoc } from './richText/format';
import { giftGuidePath, picksAnchor, picksPath } from './routes';
import type { GuestSettings } from './settings';
import { isOpenSession, type SessionWindow } from './sessionWindow';

/** Every bound the home page reads or shows, so a read cannot grow with the catalog. */
export const homeLimits = {
  /** Cards in one Ramble Picks module; the rest are behind its "See all" link. */
  picksShown: 3,
  /** Entries of one collection looked at to find that many cards, in case some cannot be shown. */
  picksCandidates: 12,
  /** Cards in the "On this week" module. */
  thisWeekShown: 4,
  /** Experiences "On this week" looks up, twice what it shows, so one that cannot be a card does not leave the module short. */
  thisWeekCandidates: 8,
  /** Sessions one "On this week" read looks at. */
  thisWeekSessions: 500,
  /** How far ahead "On this week" looks. */
  thisWeekDays: 7,
  /** Experiences one home read looks up by ID: 20 modules at most, each with `picksCandidates` entries. */
  maxCardIds: cardLookupLimit,
} as const;

/** The experience IDs one home read looks up, by the bound the page is built for. */
export const HomeExperienceIdsSchema = z
  .array(EntityIdSchema)
  .max(homeLimits.maxCardIds);

// ---- What the data layer hands over ----

/** The part of a session "On this week" decides from. */
export const ThisWeekSessionSchema = z.object({
  experienceId: EntityIdSchema,
  experienceStatus: z.enum(guestVisibleStatuses),
  startsAt: z.date(),
  allocation: z.int().nonnegative(),
  seatsSold: z.int().nonnegative(),
});
export type ThisWeekSession = z.infer<typeof ThisWeekSessionSchema>;

// ---- On this week ----

/**
 * The bookable experiences with a session still open in the next week, the one that starts
 * soonest first, each once. A session that has started, that starts after the window, or that has
 * no space left is not open, and a guide entry is not bookable. A start exactly at `from` is in the window, one exactly at `to` is not.
 */
export function thisWeekExperienceIds(
  sessions: readonly ThisWeekSession[],
  window: SessionWindow,
  limit: number,
): string[] {
  const open = sessions
    .filter(
      (session) =>
        session.experienceStatus === 'live' && isOpenSession(session, window),
    )
    .toSorted(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.experienceId.localeCompare(b.experienceId),
    );
  return [...new Set(open.map((session) => session.experienceId))].slice(
    0,
    limit,
  );
}

// ---- Modules ----

export const homeCopy = {
  heroEyebrow: 'This week in Brooklyn and beyond',
  heroHeading: 'Something good to do this weekend',
  heroBody:
    'Classes, walks, tastings, and trips from people who love this city. Book in a few taps.',
  categoryHeading: 'Browse by category',
  picksEyebrow: 'Ramble Picks',
  giftGuideEyebrow: 'Gift guide',
  giftGuideAction: 'Shop the gift guide',
  /** The sponsor placement under the gift guide. The editorial store has no sponsor field yet, so the line is fixed. */
  giftGuideSponsor: 'Presented by our holiday partner',
  thisWeekHeading: 'On this week',
  reassurance: [
    {
      icon: 'check',
      text: 'Free cancellation up to 24 hours before on most experiences',
    },
    {
      icon: 'clock',
      text: 'Your confirmation lands in your inbox within minutes',
    },
    { icon: 'info', text: 'Pay with card, Apple Pay, or Google Pay' },
  ] as const satisfies readonly ReassuranceFact[],
} as const;

/** A plain sentence as a rich-text document, so default copy and edited copy render the same way. */
export function docOfText(text: string): RichTextDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function hasText(doc: RichTextDoc | null): doc is RichTextDoc {
  return doc !== null && doc.content.length > 0;
}

/** One reassurance row; the Figma rows pair each fact with its own icon. */
export type ReassuranceFact = {
  icon: 'check' | 'clock' | 'info';
  text: string;
};

export type HomeCategory = { slug: string; name: string; href: string };

export type HomeModuleView =
  | {
      kind: 'hero_search';
      id: string;
      eyebrow: string;
      heading: string;
      body: RichTextDoc;
      neighborhoods: { slug: string; name: string }[];
    }
  | {
      kind: 'category_rail';
      id: string;
      heading: string;
      categories: HomeCategory[];
    }
  | {
      kind: 'picks';
      id: string;
      /** Set on the first Picks module only, so `/#picks` has one target. */
      anchor?: string;
      eyebrow: string;
      heading: string;
      summary: string | null;
      cards: ExperienceCard[];
      seeAll: { href: string; label: string };
    }
  | {
      kind: 'gift_guide';
      id: string;
      eyebrow: string;
      heading: string;
      body: RichTextDoc | null;
      action: { href: string; label: string };
      sponsor: string;
    }
  | {
      kind: 'this_week';
      id: string;
      heading: string;
      cards: ExperienceCard[];
    }
  | { kind: 'reassurance'; id: string; facts: readonly ReassuranceFact[] };

export type HomeInput = {
  /** The enabled modules in order, as the data layer reads them. */
  modules: readonly HomeModule[];
  picks: readonly Collection[];
  /** The published gift guide, which the gift guide module takes its copy from. */
  giftGuide: Collection | null;
  categories: readonly Category[];
  neighborhoods: readonly Neighborhood[];
  experiences: readonly CardExperience[];
  /** The experiences with an open session this week, soonest first, and what their cards need. */
  thisWeek: {
    experienceIds: readonly string[];
    experiences: readonly CardExperience[];
  };
  settings: Pick<GuestSettings, 'giftsEnabled'>;
};

/**
 * The one copy rule for a module that shows a collection: the module's own heading wins, else the
 * collection's title; the collection's summary is what the module says beneath it.
 */
export function collectionModuleCopy(
  module: Pick<HomeModule, 'heading'>,
  collection: Pick<Collection, 'title' | 'summary'>,
): { heading: string; summary: string | null } {
  return {
    heading: module.heading ?? collection.title,
    summary: collection.summary,
  };
}

function pickModuleIds(
  module: HomeModule,
  picks: readonly Collection[],
): string[] {
  if (module.kind !== 'picks' || module.collectionId === null) return [];
  const pick = picks.find(
    (collection) => collection.id === module.collectionId,
  );
  return (
    pick?.items
      .slice(0, homeLimits.picksCandidates)
      .map((item) => item.experienceId) ?? []
  );
}

/** The experiences the Picks modules might show, each once and at most `maxCardIds`, for one read by ID. */
export function homeExperienceIds(
  modules: readonly HomeModule[],
  picks: readonly Collection[],
): string[] {
  return [
    ...new Set(modules.flatMap((module) => pickModuleIds(module, picks))),
  ].slice(0, homeLimits.maxCardIds);
}

type ModuleContext = Omit<HomeInput, 'modules' | 'thisWeek'> & {
  thisWeek: readonly ExperienceCard[];
};

function viewOf(
  module: HomeModule,
  context: ModuleContext,
): HomeModuleView | null {
  switch (module.kind) {
    case 'hero_search':
      return {
        kind: 'hero_search',
        id: module.id,
        eyebrow: homeCopy.heroEyebrow,
        heading: module.heading ?? homeCopy.heroHeading,
        body: hasText(module.body) ? module.body : docOfText(homeCopy.heroBody),
        neighborhoods: context.neighborhoods.map(({ slug, name }) => ({
          slug,
          name,
        })),
      };
    case 'category_rail':
      return context.categories.length === 0
        ? null
        : {
            kind: 'category_rail',
            id: module.id,
            heading: module.heading ?? homeCopy.categoryHeading,
            categories: context.categories.map(({ slug, name }) => ({
              slug,
              name,
              href: hrefForFilters({ ...noFilters, categories: [slug] }),
            })),
          };
    case 'picks': {
      const pick = context.picks.find(
        (collection) => collection.id === module.collectionId,
      );
      if (!pick) return null;
      const cards = cardsInOrder(
        pickModuleIds(module, context.picks),
        context.experiences,
        homeLimits.picksShown,
      );
      if (cards.length === 0) return null;
      const copy = collectionModuleCopy(module, pick);
      return {
        kind: 'picks',
        id: module.id,
        eyebrow: homeCopy.picksEyebrow,
        heading: copy.heading,
        summary: copy.summary,
        cards,
        seeAll: {
          href: picksPath(pick.slug),
          label: `See all ${String(pick.items.length)} picks`,
        },
      };
    }
    case 'gift_guide': {
      if (!context.settings.giftsEnabled) return null;
      const guide =
        context.giftGuide?.id === module.collectionId
          ? context.giftGuide
          : null;
      if (module.heading === null && !guide) return null;
      const copy = guide
        ? collectionModuleCopy(module, guide)
        : { heading: module.heading ?? '', summary: null };
      return {
        kind: 'gift_guide',
        id: module.id,
        eyebrow: homeCopy.giftGuideEyebrow,
        heading: copy.heading,
        body: hasText(module.body)
          ? module.body
          : copy.summary
            ? docOfText(copy.summary)
            : null,
        action: { href: giftGuidePath, label: homeCopy.giftGuideAction },
        sponsor: homeCopy.giftGuideSponsor,
      };
    }
    case 'this_week':
      return context.thisWeek.length === 0
        ? null
        : {
            kind: 'this_week',
            id: module.id,
            heading: module.heading ?? homeCopy.thisWeekHeading,
            cards: context.thisWeek.slice(0, homeLimits.thisWeekShown),
          };
    case 'reassurance':
      return {
        kind: 'reassurance',
        id: module.id,
        facts: homeCopy.reassurance,
      };
  }
}

/**
 * The modules the page shows, in the order staff arranged them. A module with nothing to show is
 * left out whole: a Picks module whose collection is missing or has no card, a category rail with
 * no category, "On this week" with no open session, and the gift guide while gifts are switched off.
 */
function buildViews(input: HomeInput): HomeModuleView[] {
  const { modules, thisWeek, ...rest } = input;
  const context = {
    ...rest,
    thisWeek: cardsInOrder(
      thisWeek.experienceIds,
      thisWeek.experiences,
      homeLimits.thisWeekShown,
    ),
  };
  const views = modules.flatMap((module) => {
    const view = viewOf(module, context);
    return view ? [view] : [];
  });
  const firstPicks = views.findIndex((view) => view.kind === 'picks');
  return views.map((view, index) =>
    view.kind === 'picks' && index === firstPicks
      ? { ...view, anchor: picksAnchor }
      : view,
  );
}

export type HomePage =
  /** No module is switched on, or none has anything to show. */
  | { kind: 'empty' }
  | {
      kind: 'modules';
      modules: HomeModuleView[];
      /** The hero carries the page's h1; without a hero the page needs one of its own. */
      needsTitle: boolean;
    };

/** What the home page shows. */
export function buildHomePage(input: HomeInput): HomePage {
  const modules = buildViews(input);
  if (modules.length === 0) return { kind: 'empty' };
  return {
    kind: 'modules',
    modules,
    needsTitle: !modules.some((view) => view.kind === 'hero_search'),
  };
}

/** The experiences the page's cards show, each once, for one read of their cover photos. */
export function homeCardIds(page: HomePage): string[] {
  if (page.kind === 'empty') return [];
  return [
    ...new Set(
      page.modules.flatMap((module) =>
        module.kind === 'picks' || module.kind === 'this_week'
          ? module.cards.map((card) => card.id)
          : [],
      ),
    ),
  ];
}

/** The page with each card's cover photo set. */
export function withHomeCovers(
  page: HomePage,
  covers: ReadonlyMap<string, PhotoView>,
): HomePage {
  if (page.kind === 'empty') return page;
  return {
    ...page,
    modules: page.modules.map((module) =>
      module.kind === 'picks' || module.kind === 'this_week'
        ? { ...module, cards: withCovers(module.cards, covers) }
        : module,
    ),
  };
}

/** The site banner: its text, or null when there is none or it is blank. */
export function bannerText(
  settings: Pick<GuestSettings, 'bannerText'>,
): string | null {
  const text = settings.bannerText?.trim() ?? '';
  return text === '' ? null : text;
}
