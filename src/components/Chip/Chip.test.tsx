import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import { createRef, type ComponentProps, type MouseEvent } from 'react';
import { Chip, DisclosureChip } from './Chip';

describe('Chip', () => {
  it.each([true, false])('reports selected=%s as pressed', (selected) => {
    render(<Chip selected={selected} label="Outdoor" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Outdoor' })).toHaveAttribute(
      'aria-pressed',
      String(selected),
    );
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<Chip selected={false} label="Outdoor" onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('hands its button to a ref, so a caller can move focus to it', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Chip ref={ref} selected={false} label="Outdoor" onToggle={vi.fn()} />,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Outdoor' }));
  });

  it('shows the count, including zero', () => {
    render(<Chip selected={false} label="Kids" count={0} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Kids0');
  });

  it('does not toggle when disabled', async () => {
    const onToggle = vi.fn();
    render(<Chip disabled selected={false} label="Kids" onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('Chip props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Chip>>().not.toHaveProperty('className');
    expectTypeOf<ComponentProps<typeof Chip>>().not.toHaveProperty('style');
  });
});

describe('DisclosureChip', () => {
  it('announces that it opens a dialog and has no pressed state', () => {
    render(
      <DisclosureChip
        popup="dialog"
        label="Filters"
        count={2}
        onOpen={vi.fn()}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Filters2' });
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).not.toHaveAttribute('aria-pressed');
  });

  it('hands the click to onOpen, so the caller knows which chip opened it', async () => {
    let opener: EventTarget | null = null;
    const onOpen = vi.fn((event: MouseEvent<HTMLButtonElement>) => {
      opener = event.currentTarget;
    });
    render(<DisclosureChip popup="dialog" label="Guests" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guests' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(opener).toBe(screen.getByRole('button', { name: 'Guests' }));
  });

  it('passes data and aria attributes through, such as busy', () => {
    render(
      <DisclosureChip
        popup="dialog"
        label="Guests"
        aria-busy
        data-kind="guests"
        onOpen={vi.fn()}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Guests' });
    expect(chip).toHaveAttribute('aria-busy', 'true');
    expect(chip).toHaveAttribute('data-kind', 'guests');
  });
});
