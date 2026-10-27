import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import styles from './BrowseSkeleton.stories.module.css';

const meta = {
  title: 'Composites/BrowseSkeleton',
  component: BrowseSkeleton,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BrowseSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
