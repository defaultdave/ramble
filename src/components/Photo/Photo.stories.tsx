import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Photo } from '@/components/Photo';
import { samplePhoto } from './Photo.fixtures';
import styles from './Photo.stories.module.css';

const meta = {
  title: 'Primitives/Photo',
  component: Photo,
  args: { photo: samplePhoto(0), sizes: '(min-width: 768px) 384px, 100vw' },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Photo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Preload: Story = { args: { preload: true } };
export const Decorative: Story = {
  args: { photo: samplePhoto(1, { alt: '' }) },
};
