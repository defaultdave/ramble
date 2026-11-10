import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  ConfirmDestructive,
  type ConfirmDestructiveProps,
} from '@/components/ConfirmDestructive';

const settles: ConfirmDestructiveProps['action'] = () => undefined;

const neverSettles: ConfirmDestructiveProps['action'] = () =>
  new Promise<void>(() => {
    // Never settles, so the story holds the loading state.
  });

const meta = {
  title: 'Ops/ConfirmDestructive',
  component: ConfirmDestructive,
  args: {
    triggerLabel: 'Cancel order',
    title: 'Cancel this order?',
    description:
      'The guest is refunded in full and their seats go back on sale. This cannot be undone.',
    confirmLabel: 'Yes, cancel order',
    cancelLabel: 'Keep order',
    action: settles,
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 'var(--space-4)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmDestructive>;

export default meta;
type Story = StoryObj<typeof meta>;

const openDialog: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Cancel order' }),
  );
  await expect(
    await within(document.body).findByRole('dialog', {
      name: 'Cancel this order?',
    }),
  ).toBeInTheDocument();
};

export const Closed: Story = {};

/** Cancel holds focus first. */
export const Open: Story = {
  parameters: { colorScheme: 'light' },
  play: openDialog,
};

export const OpenDark: Story = {
  parameters: { colorScheme: 'dark' },
  play: openDialog,
};

/** The action has not answered yet: the confirm button shows its loading state and ignores a second press. */
export const Submitting: Story = {
  parameters: { colorScheme: 'light' },
  args: {
    action: neverSettles,
  },
  play: async (context) => {
    await openDialog(context);
    await userEvent.click(
      await within(document.body).findByRole('button', {
        name: 'Yes, cancel order',
      }),
    );
  },
};
