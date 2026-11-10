import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HiddenFields } from '@/components/HiddenFields';
import { ConfirmDestructive } from './ConfirmDestructive';

// Behaviours under test, one per decision, branch or risk:
// - nothing is asked or run until the trigger is pressed
// - the dialog states what will be lost, and Cancel has focus first
// - Cancel and Escape close it without running the action
// - Confirm runs the action once with the form's fields, then closes the dialog
// - a failing action still closes the dialog (the error is the framework's to show)

const description = 'This cannot be undone.';

function setup(action = vi.fn<(formData: FormData) => void | Promise<void>>()) {
  render(
    <ConfirmDestructive
      triggerLabel="Delete note"
      title="Delete this note?"
      description={description}
      confirmLabel="Yes, delete"
      cancelLabel="Keep note"
      action={action}
    >
      <HiddenFields fields={[['noteId', 'n-1']]} />
    </ConfirmDestructive>,
  );
  return { action, user: userEvent.setup() };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Delete note' }));
  return screen.findByRole('dialog', { name: 'Delete this note?' });
}

describe('ConfirmDestructive', () => {
  it('shows only the trigger until it is pressed', () => {
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeVisible();
  });

  it('says what will be lost and gives Cancel focus first', async () => {
    const { user } = setup();
    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent(description);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep note' })).toHaveFocus();
    });
  });

  it('closes on Cancel and on Escape without running the action', async () => {
    const { action, user } = setup();
    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Keep note' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(action).not.toHaveBeenCalled();
  });

  it('runs the action once with the form fields on Confirm, then closes', async () => {
    const { action, user } = setup();
    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const formData = action.mock.calls[0]?.[0];
    expect(formData?.get('noteId')).toBe('n-1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes even when the action fails', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('refused')));
    const { user } = setup(failing);
    await openDialog(user);
    // React reports the failed form action as an unhandled rejection; the dialog closing is what is under test.
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    window.removeEventListener('unhandledrejection', onRejection);
  });
});
