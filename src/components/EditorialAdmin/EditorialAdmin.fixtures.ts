import type { Collection, HelpArticle, HomeModule } from '@/lib/editorial';
import { buildEntryRows } from '@/lib/editorialAdmin';
import {
  addableOptions,
  buildCollectionRows,
  buildItemRows,
  type ExperienceChoice,
} from '@/lib/editorialCollections';
import { buildHomeModuleRows, pickOptions } from '@/lib/editorialHome';
import { paragraphs } from '@/lib/richText/paragraphs';

export const publishedArticle: HelpArticle = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  slug: 'how-to-cancel',
  title: 'How to cancel',
  summary: 'Cancel up to the free-cancellation deadline.',
  position: 1,
  status: 'published',
  body: paragraphs(
    'Open your booking and choose Cancel.',
    'Refunds follow the deadline shown there.',
  ),
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  publishedAt: new Date('2026-11-02T15:00:00Z'),
};

export const draftArticle: HelpArticle = {
  ...publishedArticle,
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  slug: 'where-to-meet',
  title: 'Where to meet',
  summary: null,
  status: 'draft',
  publishedAt: null,
};

export const rows = buildEntryRows([publishedArticle, draftArticle]);

export const pickId = '2b1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const potteryId = '3c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const weavingId = '4d1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const glassId = '5e1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

export const livePick: Collection = {
  id: pickId,
  kind: 'pick',
  slug: 'weekend-workshops',
  title: 'Weekend workshops',
  summary: 'Make something with your hands.',
  intro: paragraphs('Our favorite ways to spend a Saturday.'),
  status: 'published',
  publishedAt: new Date('2026-11-02T15:00:00Z'),
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  items: [
    { experienceId: potteryId, note: 'Good for beginners' },
    { experienceId: weavingId, note: null },
  ],
};

export const draftPick: Collection = {
  ...livePick,
  id: '6f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  slug: 'rainy-days',
  title: 'Rainy days',
  summary: null,
  intro: null,
  status: 'draft',
  publishedAt: null,
  items: [],
};

export const collectionRows = buildCollectionRows([livePick, draftPick]);

const experienceChoices: ExperienceChoice[] = [
  { id: potteryId, name: 'Pottery night', status: 'live' },
  { id: weavingId, name: 'Weaving for two', status: 'live' },
  { id: glassId, name: 'Glass blowing', status: 'draft' },
];

export const itemRows = buildItemRows(livePick.items, experienceChoices);
export const addOptions = addableOptions(livePick.items, experienceChoices);

const homeModule = (
  position: number,
  fields: Pick<HomeModule, 'kind'> & Partial<HomeModule>,
): HomeModule => ({
  id: `7${String(position)}1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b`,
  position,
  enabled: true,
  heading: null,
  collectionId: null,
  body: null,
  ...fields,
});

export const heroModule = homeModule(0, {
  kind: 'hero_search',
  heading: 'Find something to do',
  body: paragraphs('Book a class, a tour, or a table.'),
});
export const picksModule = homeModule(1, {
  kind: 'picks',
  collectionId: pickId,
});
const giftModule = homeModule(2, { kind: 'gift_guide' });
export const weekModule = homeModule(3, { kind: 'this_week', enabled: false });

const homeModules = [heroModule, picksModule, giftModule, weekModule];
export const homeRows = buildHomeModuleRows(homeModules, [livePick]);
export const picks = pickOptions([livePick, draftPick]);

/** Every story renders the page twice, once per color scheme. */
export const adminStoryA11y = {
  config: {
    rules: [
      { id: 'duplicate-id', enabled: false },
      { id: 'duplicate-id-aria', enabled: false },
      { id: 'landmark-unique', enabled: false },
      { id: 'landmark-banner-is-top-level', enabled: false },
      { id: 'landmark-no-duplicate-banner', enabled: false },
      { id: 'page-has-heading-one', enabled: false },
    ],
  },
};
