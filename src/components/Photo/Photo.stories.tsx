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

export const Underlay: Story = {
  args: { underlaySizes: cardPhotoSizes.vertical, sizes: '100vw' },
  play: async ({ canvasElement }) => {
    const light = canvasElement.querySelector('[data-scheme="light"]');
    const layers = light?.querySelectorAll('img') ?? [];
    await expect(layers).toHaveLength(2);
    await expect(layers[0]).toHaveAttribute('alt', '');
    await expect(layers[1]).toHaveAttribute('alt', 'Photo 1');
  },
};

// A data address that is not an image, so the load fails the way a missing file does.
const unloadable = 'data:image/png;base64,AAAA';

// The browser draws a failed photo as its icon and alt text unless the stylesheet generates a box first.
async function expectNoBrokenImageDrawing(canvasElement: HTMLElement) {
  const light = canvasElement.querySelector('[data-scheme="light"]');
  const failed = Array.from(light?.querySelectorAll('img') ?? []).filter(
    (image) => image.alt !== '',
  );
  await expect(failed).toHaveLength(1);
  const [image] = failed;
  await waitFor(() => expect(image?.complete).toBe(true));
  await expect(image?.naturalWidth).toBe(0);
  if (image) {
    const box = getComputedStyle(image, '::before');
    await expect(box.display).toBe('block');
    await expect(box.content).not.toBe('none');
  }
}

export const Failed: Story = {
  args: { photo: samplePhoto(0, { src: unloadable }) },
  play: async ({ canvasElement }) => {
    await expectNoBrokenImageDrawing(canvasElement);
  },
};

export const FailedOverUnderlay: Story = {
  args: {
    photo: samplePhoto(0, { src: unloadable }),
    underlaySizes: cardPhotoSizes.vertical,
    sizes: '100vw',
  },
  play: async ({ canvasElement }) => {
    await expectNoBrokenImageDrawing(canvasElement);
  },
};
