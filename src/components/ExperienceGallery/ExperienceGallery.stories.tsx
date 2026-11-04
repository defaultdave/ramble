import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ExperienceGallery } from '@/components/ExperienceGallery';
import { samplePhotos } from '@/components/Photo/Photo.fixtures';
import { galleryView } from '@/lib/pages/experience';

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

// A closed "See all" is a group too, so the strip is found by its name.
const photosOf = /^Photos of /;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

export const ManyMobile: Story = {
  globals: mobile,
  play: async ({ canvasElement }) => {
    // The strip scrolls on a phone, so it is a group a keyboard can reach, and each photo is drawn once.
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getAllByRole('group', { name: photosOf })[0],
      ).toHaveAttribute('tabindex', '0'),
    );
    // Every story renders the gallery once per color scheme, so each photo is there twice and no more.
    await expect(canvas.getAllByRole('img', { hidden: true })).toHaveLength(30);
  },
};
export const ManyDesktop: Story = {
  globals: desktop,
  parameters: fullWidth,
  play: async ({ canvasElement }) => {
    // The grid shows three photos; the rest are behind "See all".
    const canvas = within(canvasElement);
    await expect(canvas.getByText('See all 15 photos')).toBeVisible();
    // Nothing scrolls here, so the strip is neither a group nor a tab stop.
    await waitFor(() =>
      expect(canvas.queryByRole('group', { name: photosOf })).toBeNull(),
    );
    await expect(canvas.getAllByRole('img')).toHaveLength(3);
  },
};
export const ManyDesktopAllPhotos: Story = {
  globals: desktop,
  parameters: fullWidth,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('See all 15 photos'));
    await expect(canvas.getAllByRole('img')).toHaveLength(15);
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
  play: async ({ canvasElement }) => {
    // One photo fits the strip, so there is nothing to scroll and no tab stop.
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.queryByRole('group', { name: photosOf })).toBeNull(),
    );
  },
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
