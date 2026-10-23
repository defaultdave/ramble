import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('toggles when its label is clicked', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="I am 21+" />);
    await userEvent.click(screen.getByText('I am 21+'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reflects the checked prop', () => {
    render(<Checkbox checked onChange={vi.fn()} label="I am 21+" />);
    expect(screen.getByRole('checkbox', { name: 'I am 21+' })).toBeChecked();
  });

  it('describes the checkbox by its description', () => {
    render(
      <Checkbox
        checked={false}
        onChange={vi.fn()}
        label="Email me"
        description="Once a week"
      />,
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      'Once a week',
    );
  });

  it('does not toggle when disabled', async () => {
    const onChange = vi.fn();
    render(
      <Checkbox disabled checked={false} onChange={onChange} label="Terms" />,
    );
    await userEvent.click(screen.getByText('Terms'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
