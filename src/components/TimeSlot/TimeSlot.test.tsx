import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, expectTypeOf, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { TimeSlot } from './TimeSlot';

describe('TimeSlot', () => {
  it.each([
    { spacesLeft: 8, note: '8 spaces' },
    { spacesLeft: 2, note: '2 left' },
    { spacesLeft: 0, note: 'Sold out' },
  ])('shows "$note" for $spacesLeft left', ({ spacesLeft, note }) => {
    render(
      <TimeSlot
        time="2:00 PM"
        spacesLeft={spacesLeft}
        selected={false}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: `2:00 PM ${note}` }),
    ).toBeVisible();
  });

  it('calls onToggle when pressed', async () => {
    const onToggle = vi.fn();
    render(
      <TimeSlot
        time="2:00 PM"
        spacesLeft={8}
        selected={false}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reports selection with aria-pressed', () => {
    render(
      <TimeSlot time="2:00 PM" spacesLeft={8} selected onToggle={vi.fn()} />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('stays focusable and silent when sold out', async () => {
    const onToggle = vi.fn();
    render(
      <TimeSlot time="2:00 PM" spacesLeft={0} selected onToggle={onToggle} />,
    );
    const slot = screen.getByRole('button');
    expect(slot).toHaveAttribute('aria-disabled', 'true');
    expect(slot).toHaveAttribute('aria-pressed', 'false');
    expect(slot).not.toBeDisabled();
    await userEvent.click(slot);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('TimeSlot props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof TimeSlot>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof TimeSlot>>().not.toHaveProperty('style');
  });
});
