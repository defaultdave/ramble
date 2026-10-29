import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { HomeEmpty, HomeError, HomeSkeleton, HomeTitle } from '.';

// One story per state of the home page: loading (S1), error with retry (S3), and nothing to show.
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
// jsdom draws no CSS, so only a browser can say whether a rule of the alert strips the button down to a link.
const retryKeepsItsBorder: Story['play'] = async ({ canvasElement }) => {
  const button = within(canvasElement).getAllByRole('button', {
    name: 'Try again',
  })[0];
  if (!button) throw new Error('The retry button is missing');
  const style = getComputedStyle(button);
  await expect(style.borderTopWidth).not.toBe('0px');
  await expect(style.textDecorationLine).toBe('none');
};

export const ErrorMobile: Story = {
  render: () => <HomeError />,
  globals: mobile,
  play: retryKeepsItsBorder,
};
export const ErrorDesktop: Story = {
  render: () => <HomeError />,
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
  play: retryKeepsItsBorder,
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
