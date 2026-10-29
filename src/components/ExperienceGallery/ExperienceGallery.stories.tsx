import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ExperienceGallery } from '@/components/ExperienceGallery';
import { samplePhotos } from '@/components/Photo/Photo.fixtures';
import { galleryView } from '@/lib/experiencePage';

// One story per state of the gallery: no photo, one, two, three, and many, on a phone and from the tablet width.
const meta = {
  title: 'Experience/ExperienceGallery',
  component: ExperienceGallery,
  args: {
    title: 'Sunset kayak on the Hudson',
    gallery: galleryView(samplePhotos(15)),
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the gallery twice, once per color scheme.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
} satisfies Meta<typeof ExperienceGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

export const ManyMobile: Story = { globals: mobile };
export const ManyDesktop: Story = {
  globals: desktop,
  parameters: fullWidth,
  play: async ({ canvasElement }) => {
    // The grid shows three photos; the rest are behind "See all".
    const canvas = within(canvasElement);
    await expect(canvas.getByText('See all 15 photos')).toBeVisible();
  },
};
export const ThreeMobile: Story = {
  args: { gallery: galleryView(samplePhotos(3)) },
  globals: mobile,
};
export const ThreeDesktop: Story = {
  args: { gallery: galleryView(samplePhotos(3)) },
  globals: desktop,
  parameters: fullWidth,
};
export const TwoMobile: Story = {
  args: { gallery: galleryView(samplePhotos(2)) },
  globals: mobile,
};
export const TwoDesktop: Story = {
  args: { gallery: galleryView(samplePhotos(2)) },
  globals: desktop,
  parameters: fullWidth,
};
export const OneMobile: Story = {
  args: { gallery: galleryView(samplePhotos(1)) },
  globals: mobile,
};
export const OneDesktop: Story = {
  args: { gallery: galleryView(samplePhotos(1)) },
  globals: desktop,
  parameters: fullWidth,
};
export const NoPhotoMobile: Story = {
  args: { gallery: galleryView([]) },
  globals: mobile,
};
export const NoPhotoDesktop: Story = {
  args: { gallery: galleryView([]) },
  globals: desktop,
  parameters: fullWidth,
};
