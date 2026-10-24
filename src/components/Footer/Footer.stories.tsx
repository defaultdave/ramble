import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Footer } from '@/components/Footer';

const meta = {
  title: 'Primitives/Footer',
  component: Footer,
  args: {
    linkGroups: [
      {
        title: 'Explore',
        links: [
          { label: 'Gift guide', href: '/gifts' },
          { label: 'Ramble Picks', href: '/picks/this-week' },
          { label: 'Neighborhoods', href: '/new-york/browse' },
          { label: 'Categories', href: '/new-york/browse' },
        ],
      },
      {
        title: 'Help',
        links: [
          { label: 'Help center', href: '/help' },
          { label: 'Cancellations', href: '/help' },
          { label: 'Contact us', href: '/contact' },
        ],
      },
      {
        title: 'Ramble',
        links: [
          { label: 'About', href: '/help' },
          { label: 'Host with Ramble', href: '/contact' },
          { label: 'Terms', href: '/legal/terms' },
          { label: 'Privacy', href: '/legal/privacy' },
        ],
      },
    ],
    tagline: 'The friend who always knows what to do in New York.',
    copyright: '© 2026 Ramble. Made in Brooklyn.',
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the component twice, once per color scheme, so landmarks repeat.
        rules: [
          { id: 'landmark-no-duplicate-contentinfo', enabled: false },
          { id: 'landmark-unique', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
};
