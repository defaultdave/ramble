import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Menu } from 'lucide-react';
import { HoldTimer } from '@/components/HoldTimer';
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

const now = new Date('2026-11-02T15:00:00.000Z');

function holdTimer(secondsLeft: number) {
  return (
    <HoldTimer
      now={now}
      expiresAt={new Date(now.getTime() + secondsLeft * 1000)}
    />
  );
}

// The caller owns the menu control and its state; the header only sizes and places it.
const menuButton = (
  <button type="button" aria-label="Menu">
    <Menu aria-hidden="true" />
  </button>
);

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
  menu: menuButton,
} satisfies DefaultHeaderProps;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const Mobile: DefaultStory = { args: defaults, globals: mobile };
export const MobileWithoutGifts: DefaultStory = {
  args: { ...defaults, showGifts: false },
  globals: mobile,
};
export const MobileMenuSlot: DefaultStory = {
  args: {
    ...defaults,
    menu: (
      <button type="button" aria-label="Close menu" aria-expanded="true">
        <Menu aria-hidden="true" />
      </button>
    ),
  },
  globals: mobile,
};
export const Desktop: DefaultStory = { args: defaults, globals: desktop };
export const MobileCheckout: CheckoutStory = {
  args: { variant: 'checkout', holdTimer: holdTimer(582) },
  globals: mobile,
};
export const MobileCheckoutWarning: CheckoutStory = {
  args: { variant: 'checkout', holdTimer: holdTimer(72) },
  globals: mobile,
};
export const DesktopCheckout: CheckoutStory = {
  args: { variant: 'checkout', holdTimer: holdTimer(582) },
  globals: desktop,
};
