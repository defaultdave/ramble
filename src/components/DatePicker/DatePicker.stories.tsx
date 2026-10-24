import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import { DatePicker } from '@/components/DatePicker';
import styles from './DatePicker.stories.module.css';

const meta = {
  title: 'Composites/DatePicker',
  component: DatePicker,
  args: {
    label: 'Choose a date',
    value: '2026-10-24',
    today: '2026-10-18',
    availableDates: [
      '2026-10-18',
      '2026-10-22',
      '2026-10-24',
      '2026-10-25',
      '2026-10-29',
      '2026-10-31',
    ],
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NothingChosen: Story = { args: { value: null } };
export const NoSessionsThisMonth: Story = {
  args: { value: null, availableDates: [] },
};
export const Disabled: Story = { args: { disabled: true } };

export const Interactive: Story = {
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(args.value);
    return <DatePicker {...args} value={value} onChange={setValue} />;
  },
};
