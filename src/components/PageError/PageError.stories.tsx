import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { PageError, type PageErrorProps } from '.';

// One story per caller's copy (S3, error with retry), on a phone and from the tablet width.
const meta = {
  title: 'Layout/PageError',
  component: PageError,
  parameters: {
    a11y: {
      config: {
        // Every story renders the state twice, once per color scheme.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
} satisfies Meta<typeof PageError>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

const home: PageErrorProps = {
  title: 'Ramble',
  alertTitle: "We couldn't load the home page",
  alertBody: 'Something went wrong on our side. Try again in a moment.',
  retryHref: '/',
};
const experience: PageErrorProps = {
  title: 'Experience',
  alertTitle: "We couldn't load this experience",
  alertBody: 'Something went wrong on our side. Try again in a moment.',
  retryHref: '/experiences/sunset-kayak-1',
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

export const HomeMobile: Story = {
  args: home,
  globals: mobile,
  play: retryKeepsItsBorder,
};
export const HomeDesktop: Story = {
  args: home,
  globals: desktop,
  parameters: fullWidth,
  play: retryKeepsItsBorder,
};
export const ExperienceMobile: Story = {
  args: experience,
  globals: mobile,
  play: retryKeepsItsBorder,
};
export const ExperienceDesktop: Story = {
  args: experience,
  globals: desktop,
  parameters: fullWidth,
  play: retryKeepsItsBorder,
};
