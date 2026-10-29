import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Trees } from 'lucide-react';
import {
  Card,
  type BookableCardProps,
  type GuideOnlyCardProps,
} from '@/components/Card';
import styles from './Card.stories.module.css';

const meta = {
  title: 'Primitives/Card',
  component: Card,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;

// Card is a union on kind, which Storybook cannot infer args from, so each story names its props.
type BookableStory = StoryObj<BookableCardProps>;
type GuideOnlyStory = StoryObj<GuideOnlyCardProps>;

const bookable = {
  title: 'Sunset kayak on the Hudson',
  meta: 'Pier 26 · 2\u00a0hr',
  href: '/experiences/sunset-kayak-on-the-hudson-1',
  image: null,
  price: 'From $65',
} satisfies BookableCardProps;

const guideOnly = {
  title: 'Sunset kayak on the Hudson',
  meta: 'Pier 26 · 2\u00a0hr',
  href: '/guide/sunset-kayak-on-the-hudson-1',
  image: null,
  kind: 'guide-only',
  hostHref: 'https://host.example/kayak',
} satisfies GuideOnlyCardProps;

const tag = { label: 'Outdoor', tone: 'green', icon: <Trees /> } as const;
const rating = { average: 4.9, count: 12 };

export const Vertical: BookableStory = {
  args: { ...bookable, showPick: true, tag },
};
export const VerticalWithRating: BookableStory = {
  args: { ...bookable, showPick: true, tag, rating },
};
export const VerticalPlain: BookableStory = { args: bookable };
export const VerticalGuideOnly: GuideOnlyStory = {
  args: { ...guideOnly, tag },
};
export const Horizontal: BookableStory = {
  args: { ...bookable, layout: 'horizontal' },
};
export const HorizontalWithRating: BookableStory = {
  args: { ...bookable, layout: 'horizontal', rating },
};
export const HorizontalGuideOnly: GuideOnlyStory = {
  args: { ...guideOnly, layout: 'horizontal' },
};
