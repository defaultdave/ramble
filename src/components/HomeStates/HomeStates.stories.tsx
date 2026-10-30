import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HomeEmpty, HomeSkeleton, HomeTitle } from '.';

// One story per state of the home page: loading (S1) and nothing to show.
const meta = {
  title: 'Home/HomeStates',
  parameters: {
    a11y: {
      config: {
        // Every story renders the state twice, once per color scheme.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { colorScheme: 'light' } as const;

export const LoadingMobile: Story = {
  render: () => <HomeSkeleton />,
  globals: mobile,
};
export const LoadingDesktop: Story = {
  render: () => <HomeSkeleton />,
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const EmptyMobile: Story = {
  render: () => <HomeEmpty />,
  globals: mobile,
};
export const EmptyDesktop: Story = {
  render: () => <HomeEmpty />,
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};
export const TitleOnly: Story = {
  render: () => <HomeTitle />,
  globals: mobile,
};
