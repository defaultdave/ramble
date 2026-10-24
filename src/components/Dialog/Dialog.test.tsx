import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import type { DialogVariant } from './Dialog';

function Harness({ variant }: { variant: DialogVariant }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <button type="button">After</button>
      <Dialog
        variant={variant}
        open={open}
        title="Filters"
        footer={<button type="button">Apply</button>}
        onClose={() => {
          setOpen(false);
        }}
      >
        <button type="button">First</button>
        <button type="button">Second</button>
      </Dialog>
    </>
  );
}

const variants: DialogVariant[] = ['sheet', 'drawer'];

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(
      <Dialog variant="sheet" open={false} title="Filters" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the dialog by its title and shows eyebrow, body, and footer', () => {
    render(
      <Dialog
        variant="sheet"
        open
        title="Sunset kayak"
        eyebrow={<span>Outdoor</span>}
        footer={<button type="button">Continue</button>}
        onClose={vi.fn()}
      >
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Sunset kayak' });
    expect(dialog).toHaveTextContent('Outdoor');
    expect(dialog).toHaveTextContent('Body');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  it('asks to close on Escape and stays open until the caller closes it', async () => {
    const onClose = vi.fn();
    render(
      <Dialog variant="drawer" open title="Filters" onClose={onClose}>
        <button type="button">First</button>
      </Dialog>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});

describe.each(variants)('Dialog focus (%s)', (variant) => {
  it('moves focus into the dialog when it opens', async () => {
    render(<Harness variant={variant} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    render(<Harness variant={variant} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog');

    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it.each([
    ['Escape', () => userEvent.keyboard('{Escape}')],
    [
      'the close button',
      () => userEvent.click(screen.getByRole('button', { name: 'Close' })),
    ],
  ])('returns focus to the opener after %s', async (_how, close) => {
    render(<Harness variant={variant} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await close();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('hides the page behind it from assistive technology while open', async () => {
    render(<Harness variant={variant} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      screen.queryByRole('button', { name: 'Before' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
  });
});
