import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Gift, MapPin } from 'lucide-react';
import { ButtonLink } from '@/components/Button';

const meta = {
  title: 'Primitives/ButtonLink',
  component: ButtonLink,
  parameters: { nextjs: { appDirectory: true } },
  args: { href: '/new-york/browse', children: 'Clear all filters' },
} satisfies Meta<typeof ButtonLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Primary: Story = { args: { variant: 'primary' } };
export const WithIcon: Story = {
  args: {
    variant: 'secondary',
    iconStart: <Gift />,
    children: 'Give this as a gift',
  },
};
export const External: Story = {
  args: {
    href: 'https://www.google.com/maps/search/?api=1&query=Pier%2026',
    external: true,
    iconStart: <MapPin />,
    children: 'Open in Maps',
  },
};
