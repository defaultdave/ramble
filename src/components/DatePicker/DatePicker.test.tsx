import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import { DatePicker } from './DatePicker';

const today = '2026-10-18';
const availableDates = ['2026-10-18', '2026-10-22', '2026-10-24', '2026-11-03'];

function setup(value: string | null = '2026-10-24', disabled = false) {
  const onChange = vi.fn();
  render(
    <DatePicker
      label="Choose a date"
      value={value}
      today={today}
      availableDates={availableDates}
      disabled={disabled}
      onChange={onChange}
    />,
  );
  return onChange;
}

const day = (name: RegExp) => screen.getByRole('button', { name });

describe('DatePicker', () => {
  it('shows a labelled grid for the month of the chosen date', () => {
    setup();
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
    expect(screen.getByText('October 2026')).toBeVisible();
  });

  it('opens on the month of today when nothing is chosen', () => {
    setup(null);
    expect(screen.getByText('October 2026')).toBeVisible();
  });

  it('marks the chosen date as selected', () => {
    setup();
    expect(day(/Saturday, October 24, 2026/).closest('td')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('reports an available date as YYYY-MM-DD', async () => {
    const onChange = setup();
    await userEvent.click(day(/Thursday, October 22, 2026/));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-22');
  });

  it.each([
    ['a date with no sessions', /Friday, October 23, 2026/],
    ['a date before today', /Friday, October 16, 2026/],
  ])('ignores a click on %s', async (_name, label) => {
    const onChange = setup();
    await userEvent.click(day(label));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves between dates with the arrow keys and picks with Enter', async () => {
    const onChange = setup();
    await userEvent.click(day(/Saturday, October 24, 2026/));
    onChange.mockClear();
    expect(day(/Saturday, October 24, 2026/)).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(day(/Thursday, October 22, 2026/)).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-22');
  });

  it('pages to the next month', async () => {
    const onChange = setup();
    // React Aria adds visually hidden copies of the paging buttons for screen readers.
    const [next] = screen.getAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    expect(screen.getByRole('grid', { name: /November 2026/ })).toBeVisible();
    await userEvent.click(day(/Tuesday, November 3, 2026/));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-11-03');
  });

  it('cannot page to a month before today', () => {
    setup(null);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('ignores clicks when disabled', async () => {
    const onChange = setup('2026-10-24', true);
    await userEvent.click(day(/Thursday, October 22, 2026/));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DatePicker props', () => {
  it('rejects className and style', () => {
    // The wrapper owns its styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof DatePicker>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof DatePicker>>().not.toHaveProperty(
      'style',
    );
  });
});
