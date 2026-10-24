import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { BookingSheet } from './BookingSheet';

describe('BookingSheet', () => {
  it('shows the experience name, eyebrow, content, and footer', () => {
    render(
      <BookingSheet
        open
        title="Sunset kayak on the Hudson"
        eyebrow={<span>Outdoor</span>}
        footer={<button type="button">Continue</button>}
        onClose={vi.fn()}
      >
        <p>Pick a date</p>
      </BookingSheet>,
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Sunset kayak on the Hudson',
    });
    expect(dialog).toHaveTextContent('Outdoor');
    expect(dialog).toHaveTextContent('Pick a date');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  it('asks to close from the Close button', async () => {
    const onClose = vi.fn();
    render(
      <BookingSheet open title="Sunset kayak" onClose={onClose}>
        <p>Pick a date</p>
      </BookingSheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('BookingSheet props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof BookingSheet>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof BookingSheet>>().not.toHaveProperty(
      'style',
    );
  });
});
