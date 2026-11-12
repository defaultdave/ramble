import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CheckField } from './CheckField';

const meta = {
  title: 'Ops/CheckField',
  component: CheckField,
  args: {
    name: 'agree',
    label: 'The host has accepted the current agreement.',
  },
} satisfies Meta<typeof CheckField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unticked: Story = {};
export const Ticked: Story = { args: { defaultChecked: true } };
export const WithProblem: Story = {
  args: { problem: 'The agreement version could not be read.' },
};
