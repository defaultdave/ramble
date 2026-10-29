import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ExperienceCardItem } from '@/components/ExperienceCard';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { ExperienceCard } from '@/lib/experienceCards';
import styles from './ExperienceCardItem.stories.module.css';

const meta = {
  title: 'Composites/ExperienceCardItem',
  component: ExperienceCardItem,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExperienceCardItem>;

export default meta;

type Story = StoryObj<typeof meta>;

const bookable = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Sunset kayak on the Hudson',
  meta: 'Pier 26 · 2 hr',
  href: '/experiences/sunset-kayak-on-the-hudson-1',
  image: samplePhoto(0),
  kind: 'bookable',
  price: 'From $65',
} satisfies ExperienceCard;

const guideOnly = {
  id: '00000000-0000-4000-8000-000000000002',
  title: 'A harbor walk with a historian',
  meta: 'Red Hook · 2 hr',
  href: '/guide/a-harbor-walk-2',
  image: null,
  kind: 'guide-only',
  hostHref: 'https://host.example/walk',
} satisfies ExperienceCard;

// A price of nothing reads "Free", never "From $0".
const free = {
  ...bookable,
  id: '00000000-0000-4000-8000-000000000003',
  title: 'Free Sunday museum tour',
  price: 'Free',
} satisfies ExperienceCard;

export const Vertical: Story = {
  args: { card: bookable, layout: 'vertical', headingLevel: 3 },
};
export const Horizontal: Story = {
  args: { card: bookable, layout: 'horizontal', headingLevel: 3 },
};
export const VerticalFree: Story = {
  args: { card: free, layout: 'vertical', headingLevel: 3 },
};
export const HorizontalFree: Story = {
  args: { card: free, layout: 'horizontal', headingLevel: 3 },
};
export const VerticalGuideOnly: Story = {
  args: { card: guideOnly, layout: 'vertical', headingLevel: 3 },
};
export const HorizontalGuideOnly: Story = {
  args: { card: guideOnly, layout: 'horizontal', headingLevel: 3 },
};
