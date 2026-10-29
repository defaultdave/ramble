import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ExperiencePage } from '@/components/ExperiencePage';
import {
  bareExperience,
  kidsClass,
  sunsetKayak,
} from './ExperiencePage.fixtures';

// One story per state of the experience page, on a phone (Figma 03) and from the tablet width (D03).
const meta = {
  title: 'Experience/ExperiencePage',
  component: ExperiencePage,
  args: { view: sunsetKayak },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme, so landmarks and ids repeat.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof ExperiencePage>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

export const OutdoorMobile: Story = { globals: mobile };
export const OutdoorDesktop: Story = {
  globals: desktop,
  parameters: fullWidth,
};
export const KidsClassMobile: Story = {
  args: { view: kidsClass },
  globals: mobile,
};
export const KidsClassDesktop: Story = {
  args: { view: kidsClass },
  globals: desktop,
  parameters: fullWidth,
};
export const BareMobile: Story = {
  args: { view: bareExperience },
  globals: mobile,
};
export const BareDesktop: Story = {
  args: { view: bareExperience },
  globals: desktop,
  parameters: fullWidth,
};
