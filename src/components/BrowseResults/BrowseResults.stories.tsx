import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BrowseResults } from '@/components/BrowseResults';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { BrowseView } from '@/lib/pages/browse';
import type { ExperienceCard } from '@/lib/experienceCards';
import styles from './BrowseResults.stories.module.css';

const cards: ExperienceCard[] = [
  {
    id: '1',
    image: null,
    kind: 'bookable',
    title: 'Hand-rolled pasta in a Carroll Gardens kitchen',
    meta: 'Carroll Gardens · 2.5\u00a0hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
  },
  {
    id: '2',
    image: null,
    kind: 'bookable',
    title: 'Dumpling folding with a Sunset Park chef',
    meta: 'Sunset Park · 2\u00a0hr',
    href: '/experiences/dumplings-2',
    price: '$60',
  },
  {
    id: '3',
    image: null,
    kind: 'guide-only',
    title: 'Sourdough mornings at Rise Bakery',
    meta: 'Park Slope',
    href: '/guide/sourdough-3',
    hostHref: 'https://host.example/sourdough',
  },
  {
    id: '4',
    image: null,
    kind: 'bookable',
    title: 'Fresh mozzarella, stretched by hand',
    meta: 'Bensonhurst · 1.5\u00a0hr',
    href: '/experiences/mozzarella-4',
    price: '$55',
  },
  {
    id: '5',
    image: null,
    kind: 'bookable',
    title: 'Knife skills for home cooks',
    meta: 'Gowanus · 2\u00a0hr',
    href: '/experiences/knives-5',
    price: '$75',
  },
  {
    id: '6',
    image: null,
    kind: 'bookable',
    title: 'Bao from scratch',
    meta: 'Sunset Park · 2.5\u00a0hr',
    href: '/experiences/bao-6',
    price: '$70',
  },
];

const nextPage = {
  action: '/new-york/browse',
  fields: [
    ['category', 'cooking'],
    ['after', '00000000-0000-4000-8000-000000000006'],
  ],
} as const;

const meta = {
  title: 'Composites/BrowseResults',
  component: BrowseResults,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BrowseResults>;

export default meta;

// The results are a union on state, which Storybook cannot infer args from, so each story names its props.
type ViewOf<State extends BrowseView['state']> = Extract<
  BrowseView,
  { state: State }
>;
type ResultsStory = StoryObj<ViewOf<'results'>>;
type EmptyStory = StoryObj<ViewOf<'empty'>>;
type ErrorStory = StoryObj<ViewOf<'error'>>;
type OutdatedStory = StoryObj<ViewOf<'outdated'>>;

export const Results: ResultsStory = {
  args: {
    state: 'results',
    cards,
    summary: 'Showing 6 experiences',
    showMore: nextPage,
    startHref: null,
  },
};

// The cover is the first photo of the experience; a card with none keeps its empty frame.
export const WithCoverPhotos: ResultsStory = {
  args: {
    state: 'results',
    cards: cards.map((card, index) =>
      index === 2 || index === 4
        ? card
        : { ...card, image: samplePhoto(index) },
    ),
    summary: 'Showing 6 experiences',
    showMore: nextPage,
    startHref: null,
  },
};

export const LastPage: ResultsStory = {
  args: {
    state: 'results',
    cards: cards.slice(0, 3),
    summary: '3 experiences',
    showMore: null,
    startHref: null,
  },
};

export const LaterPage: ResultsStory = {
  args: {
    state: 'results',
    cards: cards.slice(0, 4),
    summary: 'Showing 4 experiences',
    showMore: nextPage,
    startHref: '/new-york/browse?category=cooking',
  },
};

export const SingleResult: ResultsStory = {
  args: {
    state: 'results',
    cards: cards.slice(0, 1),
    summary: '1 experience',
    showMore: null,
    startHref: null,
  },
};

export const EmptyWithFilters: EmptyStory = {
  args: { state: 'empty', filtered: true, dated: null },
};

export const EmptyWithoutFilters: EmptyStory = {
  args: { state: 'empty', filtered: false, dated: null },
};

// A chosen day with nothing on it: the next day that has experiences, and the same filters with any day.
export const EmptyOnADay: EmptyStory = {
  args: {
    state: 'empty',
    filtered: true,
    dated: {
      dateLabel: 'Wed, Oct 28',
      nextDay: {
        label: 'Thu, Oct 29',
        href: '/new-york/browse?category=cooking&date=2026-10-29',
      },
      anyDayHref: '/new-york/browse?category=cooking',
      message: 'The next day with experiences is Thu, Oct 29.',
    },
  },
};

export const EmptyOnADayWithNoLaterDay: EmptyStory = {
  args: {
    state: 'empty',
    filtered: true,
    dated: {
      dateLabel: 'Wed, Feb 24',
      nextDay: null,
      anyDayHref: '/new-york/browse',
      message: 'There are no experiences on later days.',
    },
  },
};

export const ErrorWithRetry: ErrorStory = {
  args: { state: 'error', retry: nextPage },
};

export const Outdated: OutdatedStory = {
  args: { state: 'outdated', startHref: '/new-york/browse?category=cooking' },
};
