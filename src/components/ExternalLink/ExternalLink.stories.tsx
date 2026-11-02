import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ExternalLink } from './ExternalLink';

const meta = {
  title: 'Primitives/ExternalLink',
  component: ExternalLink,
  args: { href: 'https://host.example/terms', children: 'Read the terms' },
} satisfies Meta<typeof ExternalLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
