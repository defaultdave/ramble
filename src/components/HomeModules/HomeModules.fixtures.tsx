import type { ReactNode } from 'react';
import type { ExperienceCard } from '@/lib/experienceCards';
import { homeCopy, type HomeModuleView } from '@/lib/home';
import { paragraphs } from '@/lib/richText/paragraphs';
import type { RichTextDoc } from '@/lib/richText/format';
import styles from './HomeModules.stories.module.css';

/** Draws a document's text as paragraphs; the page's real renderer is server-only. */
export function renderCopy(doc: RichTextDoc): ReactNode {
  return (
    <div className={styles.copy}>
      {doc.content.map((block, index) => (
        <p key={index}>
          {block.type === 'paragraph'
            ? block.content?.map((inline) =>
                inline.type === 'text' ? inline.text : ' ',
              )
            : null}
        </p>
      ))}
    </div>
  );
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const bookable = (n: number, title: string, meta: string, price: string) =>
  ({
    id: id(n),
    title,
    meta,
    href: `/experiences/thing-${String(n)}-${id(n)}`,
    image: null,
    kind: 'bookable',
    price,
  }) satisfies ExperienceCard;

const guideOnly = (n: number, title: string, meta: string) =>
  ({
    id: id(n),
    title,
    meta,
    href: `/guide/thing-${String(n)}-${id(n)}`,
    image: null,
    kind: 'guide-only',
    hostHref: 'https://host.example/walk',
  }) satisfies ExperienceCard;

const pickCards: ExperienceCard[] = [
  bookable(
    1,
    'Hand-rolled pasta in a Carroll Gardens kitchen',
    'Carroll Gardens · 2.5\u00a0hr',
    'From $85',
  ),
  bookable(
    2,
    'Wheel-throwing for first-timers',
    'Greenpoint · 2\u00a0hr',
    'From $70',
  ),
  guideOnly(3, 'A harbor walk with a historian', 'Red Hook · 2\u00a0hr'),
];

const weekCards: ExperienceCard[] = [
  bookable(4, 'Sunset kayak on the Hudson', 'Pier 26 · 2\u00a0hr', 'From $65'),
  bookable(
    5,
    'Natural wine, explained',
    'Williamsburg · 1.5\u00a0hr',
    'From $48',
  ),
  bookable(6, 'Sourdough for beginners', 'Park Slope · 3\u00a0hr', 'From $75'),
  bookable(7, 'Pottery and pints', 'Bushwick · 2\u00a0hr', '$60'),
];

export const hero: HomeModuleView = {
  kind: 'hero_search',
  id: id(901),
  eyebrow: homeCopy.heroEyebrow,
  heading: homeCopy.heroHeading,
  body: paragraphs(homeCopy.heroBody),
  neighborhoods: [
    { slug: 'carroll-gardens', name: 'Carroll Gardens' },
    { slug: 'dumbo', name: 'DUMBO' },
    { slug: 'greenpoint', name: 'Greenpoint' },
  ],
};

export const categoryRail: HomeModuleView = {
  kind: 'category_rail',
  id: id(902),
  heading: homeCopy.categoryHeading,
  categories: [
    'Ceramics and crafts',
    'Cooking',
    'Walking tours',
    'Wine and cocktails',
    'Food and coffee',
    'Outdoor',
    'Wellness',
    'Kids',
  ].map((name) => {
    const slug = name.toLowerCase().replaceAll(' ', '-');
    return { slug, name, href: `/new-york/browse?category=${slug}` };
  }),
};

export const picks: HomeModuleView = {
  kind: 'picks',
  id: id(903),
  anchor: 'picks',
  eyebrow: homeCopy.picksEyebrow,
  heading: 'Rainy day, sorted',
  summary: 'Twelve indoor plans that beat staying in, picked by our editors.',
  cards: pickCards,
  seeAll: { href: '/picks/rainy-day', label: 'See all 12 picks' },
};

export const giftGuide: HomeModuleView = {
  kind: 'gift_guide',
  id: id(904),
  eyebrow: homeCopy.giftGuideEyebrow,
  heading: 'Give a Saturday, not a sweater',
  body: paragraphs(
    'Experiences to give for every kind of person. They pick the date; you look thoughtful.',
  ),
  action: { href: '/gifts', label: homeCopy.giftGuideAction },
  sponsor: homeCopy.giftGuideSponsor,
};

export const thisWeek: HomeModuleView = {
  kind: 'this_week',
  id: id(905),
  heading: homeCopy.thisWeekHeading,
  cards: weekCards,
};

export const reassurance: HomeModuleView = {
  kind: 'reassurance',
  id: id(906),
  facts: homeCopy.reassurance,
};

/** The page as Figma draws it, in the order of the frames. */
export const fullPage: HomeModuleView[] = [
  hero,
  categoryRail,
  picks,
  giftGuide,
  thisWeek,
  reassurance,
];
