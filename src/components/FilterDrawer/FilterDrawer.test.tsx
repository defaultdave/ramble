import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { FilterDrawer } from './FilterDrawer';

function setup(open = true) {
  const handlers = { onClose: vi.fn(), onClear: vi.fn(), onApply: vi.fn() };
  render(
    <FilterDrawer open={open} applyLabel="Show 24 results" {...handlers}>
      <p>Filter groups go here</p>
    </FilterDrawer>,
  );
  return handlers;
}

describe('FilterDrawer', () => {
  it('shows the filter groups under the Filters title', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveTextContent('Filter groups go here');
  });

  it('is not rendered while closed', () => {
    setup(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wires Clear all, the apply button, and Close to their handlers', async () => {
    const { onClose, onClear, onApply } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Show 24 results' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('FilterDrawer props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof FilterDrawer>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof FilterDrawer>>().not.toHaveProperty(
      'style',
    );
  });
});
