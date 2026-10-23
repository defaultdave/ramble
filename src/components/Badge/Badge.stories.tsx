import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Accessibility } from 'lucide-react';
import { Badge } from '@/components/Badge';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { label: 'Outdoor' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = { args: { tone: 'green' } };
export const Yellow: Story = { args: { tone: 'yellow', label: '21+' } };
export const Blue: Story = { args: { tone: 'blue', label: 'Kids' } };
export const Pink: Story = { args: { tone: 'pink', label: 'Step-free' } };
export const Neutral: Story = {
  args: { tone: 'neutral', label: 'Guide only' },
};
export const WithIcon: Story = {
  args: { tone: 'pink', label: 'Step-free', icon: <Accessibility /> },
};
