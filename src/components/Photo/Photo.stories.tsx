import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor } from 'storybook/test';
import { cardPhotoSizes } from '@/components/Card';
import { Photo } from '@/components/Photo';
import { samplePhoto } from './Photo.fixtures';
import styles from './Photo.stories.module.css';

const meta = {
  title: 'Primitives/Photo',
  component: Photo,
  args: { photo: samplePhoto(0), sizes: cardPhotoSizes.vertical },
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

// The photo drawn twice: a decorative layer at the card's width beneath the named photo, which shows once loaded.
export const Underlay: Story = {
  args: { underlaySizes: cardPhotoSizes.vertical, sizes: '100vw' },
  play: async ({ canvasElement }) => {
    const layers = canvasElement.querySelectorAll('img');
    await expect(layers).toHaveLength(2);
    await expect(layers[0]).toHaveAttribute('alt', '');
    await waitFor(() =>
      expect(layers[1]).toHaveAttribute('data-loaded', 'true'),
    );
  },
};
