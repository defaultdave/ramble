import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BrowseResults } from '@/components/BrowseResults';
import type { BrowseCard, BrowseView } from '@/lib/browse';
import styles from './BrowseResults.stories.module.css';

const cards: BrowseCard[] = [
  {
    id: '1',
    kind: 'bookable',
    title: 'Hand-rolled pasta in a Carroll Gardens kitchen',
    meta: 'Carroll Gardens · 2.5 hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
  },
  {
    id: '2',
    kind: 'bookable',
    title: 'Dumpling folding with a Sunset Park chef',
    meta: 'Sunset Park · 2 hr',
    href: '/experiences/dumplings-2',
    price: '$60',
  },
  {
    id: '3',
    kind: 'guide-only',
    title: 'Sourdough mornings at Rise Bakery',
    meta: 'Park Slope',
    href: '/guide/sourdough-3',
    hostHref: 'https://host.example/sourdough',
  },
  {
    id: '4',
    kind: 'bookable',
    title: 'Fresh mozzarella, stretched by hand',
    meta: 'Bensonhurst · 1.5 hr',
    href: '/experiences/mozzarella-4',
    price: '$55',
  },
  {
    id: '5',
    kind: 'bookable',
    title: 'Knife skills for home cooks',
    meta: 'Gowanus · 2 hr',
    href: '/experiences/knives-5',
    price: '$75',
  },
  {
    id: '6',
    kind: 'bookable',
    title: 'Bao from scratch',
    meta: 'Sunset Park · 2.5 hr',
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
  args: { state: 'empty', filtered: true },
};

export const EmptyWithoutFilters: EmptyStory = {
  args: { state: 'empty', filtered: false },
};

export const ErrorWithRetry: ErrorStory = {
  args: { state: 'error', retry: nextPage },
};

export const Outdated: OutdatedStory = {
  args: { state: 'outdated', startHref: '/new-york/browse?category=cooking' },
};
