import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import {
  Header,
  type CheckoutHeaderProps,
  type DefaultHeaderProps,
} from '@/components/Header';

const meta = {
  title: 'Primitives/Header',
  component: Header,
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme, so landmarks repeat.
        rules: [
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'landmark-unique', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof Header>;

export default meta;

// Header is a union on variant, which Storybook cannot infer args from, so each story names its props.
type DefaultStory = StoryObj<DefaultHeaderProps>;
type CheckoutStory = StoryObj<CheckoutHeaderProps>;

const defaults = {
  links: [
    { label: 'Things to do', href: '/new-york/browse' },
    { label: 'Ramble Picks', href: '/picks/this-week' },
    { label: 'Neighborhoods', href: '/new-york/browse' },
    { label: 'Gift guide', href: '/gifts' },
  ],
  giftsHref: '/gifts',
  searchLabel: 'Anywhere · This weekend · 2 guests',
  searchHref: '/new-york/browse',
  onMenuClick: fn(),
} satisfies DefaultHeaderProps;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const Mobile: DefaultStory = { args: defaults, globals: mobile };
export const MobileWithoutGifts: DefaultStory = {
  args: { ...defaults, showGifts: false },
  globals: mobile,
};
export const Desktop: DefaultStory = { args: defaults, globals: desktop };
export const MobileCheckout: CheckoutStory = {
  args: { variant: 'checkout', secondsRemaining: 582 },
  globals: mobile,
};
export const MobileCheckoutWarning: CheckoutStory = {
  args: { variant: 'checkout', secondsRemaining: 72 },
  globals: mobile,
};
export const DesktopCheckout: CheckoutStory = {
  args: { variant: 'checkout', secondsRemaining: 582 },
  globals: desktop,
};
