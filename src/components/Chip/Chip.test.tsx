import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip';

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
