import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from './Stepper';

function setup(value: number, min = 0, max = 4) {
  const onChange = vi.fn();
  render(
    <Stepper
      label="Adults"
      value={value}
      min={min}
      max={max}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('Stepper', () => {
  it('shows the label and value', () => {
    setup(2);
    expect(screen.getByRole('group', { name: 'Adults' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('2');
  });

  it('steps up and down', async () => {
    const onChange = setup(2);
    await userEvent.click(
      screen.getByRole('button', { name: 'Increase Adults' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Decrease Adults' }),
    );
    expect(onChange.mock.calls).toEqual([[3], [1]]);
  });

  it('cannot go below min', async () => {
    const onChange = setup(0);
    const decrease = screen.getByRole('button', { name: 'Decrease Adults' });
    expect(decrease).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(decrease);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cannot go above max', async () => {
    const onChange = setup(4);
    const increase = screen.getByRole('button', { name: 'Increase Adults' });
    expect(increase).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(increase);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('describes the group by its hint', () => {
    render(
      <Stepper
        label="Children"
        hint="Ages 3 to 12"
        value={1}
        min={0}
        max={4}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('group')).toHaveAccessibleDescription(
      'Ages 3 to 12',
    );
  });

  it('disables both buttons when disabled', () => {
    render(
      <Stepper
        disabled
        label="Adults"
        value={1}
        min={0}
        max={4}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
