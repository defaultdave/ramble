import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ArrowRight } from 'lucide-react';
import { fn } from 'storybook/test';
import { Button } from '@/components/Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Book now', onClick: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrimaryMedium: Story = {
  args: { variant: 'primary', size: 'md' },
};
export const PrimaryLarge: Story = { args: { variant: 'primary', size: 'lg' } };
export const SecondaryMedium: Story = {
  args: { variant: 'secondary', size: 'md' },
};
export const SecondaryLarge: Story = {
  args: { variant: 'secondary', size: 'lg' },
};
export const GhostMedium: Story = { args: { variant: 'ghost', size: 'md' } };
export const GhostLarge: Story = { args: { variant: 'ghost', size: 'lg' } };
export const WithIconStart: Story = {
  args: { iconStart: <ArrowRight /> },
};
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
