import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ChipLink } from '@/components/Chip';

const meta = {
  title: 'Primitives/ChipLink',
  component: ChipLink,
  parameters: { nextjs: { appDirectory: true } },
  args: {
    label: 'Outdoor',
    href: '/new-york/browse?category=outdoor',
    selected: false,
  },
} satisfies Meta<typeof ChipLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
