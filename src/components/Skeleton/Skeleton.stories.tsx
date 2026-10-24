import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Skeleton } from '@/components/Skeleton';
import styles from './Skeleton.stories.module.css';

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = { args: { kind: 'card' } };
export const HorizontalCard: Story = { args: { kind: 'horizontal-card' } };
export const Text: Story = { args: { kind: 'text' } };
