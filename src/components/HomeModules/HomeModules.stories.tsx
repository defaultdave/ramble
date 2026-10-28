import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HomeModules } from '@/components/HomeModules';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { HomeModuleView } from '@/lib/home';
import {
  categoryRail,
  fullPage,
  giftGuide,
  hero,
  picks,
  reassurance,
  renderCopy,
  thisWeek,
} from './HomeModules.fixtures';
import styles from './HomeModules.stories.module.css';

const meta = {
  title: 'Home/HomeModules',
  component: HomeModules,
  args: { modules: fullPage, minDate: '2026-11-02', renderCopy },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme, so landmarks and the
        // picks anchor repeat; a story with one module has no h1 of its own.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof HomeModules>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { colorScheme: 'light' } as const;

export const Mobile: Story = { globals: mobile };
export const Desktop: Story = {
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const HeroMobile: Story = {
  args: { modules: [hero] },
  globals: mobile,
};
export const HeroDesktop: Story = {
  args: { modules: [hero] },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const CategoryRailMobile: Story = {
  args: { modules: [categoryRail] },
  globals: mobile,
};
export const PicksMobile: Story = {
  args: { modules: [picks] },
  globals: mobile,
};
export const PicksDesktop: Story = {
  args: { modules: [picks] },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const GiftGuideMobile: Story = {
  args: { modules: [giftGuide] },
  globals: mobile,
};
export const GiftGuideDesktop: Story = {
  args: { modules: [giftGuide] },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const ThisWeekMobile: Story = {
  args: { modules: [thisWeek] },
  globals: mobile,
};
export const ThisWeekDesktop: Story = {
  args: { modules: [thisWeek] },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const ReassuranceMobile: Story = {
  args: { modules: [reassurance] },
  globals: mobile,
};

// The cover is the first photo of the experience; a card with none keeps its empty frame.
const withCovers = (module: HomeModuleView): HomeModuleView =>
  module.kind === 'picks' || module.kind === 'this_week'
    ? {
        ...module,
        cards: module.cards.map((card, index) =>
          index === 1 ? card : { ...card, image: samplePhoto(index) },
        ),
      }
    : module;

export const PicksWithCoversMobile: Story = {
  args: { modules: [withCovers(picks)] },
  globals: mobile,
};
export const PicksWithCoversDesktop: Story = {
  args: { modules: [withCovers(picks)] },
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const ThisWeekWithCoversMobile: Story = {
  args: { modules: [withCovers(thisWeek)] },
  globals: mobile,
};
