import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
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

  it('keeps the caller aria-describedby after the description', () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Checkbox
          checked={false}
          onChange={vi.fn()}
          label="Email me"
          description="Once a week"
          aria-describedby="extra"
        />
      </>,
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      'Once a week Extra',
    );
  });

  it.each<[boolean | 'true' | 'false' | undefined, boolean]>([
    [true, true],
    ['true', true],
    [false, false],
    [undefined, false],
  ])(
    'aria-invalid=%s marks the description as invalid: %s',
    (invalid, marked) => {
      render(
        <Checkbox
          checked={false}
          onChange={vi.fn()}
          label="Email me"
          description="Once a week"
          aria-invalid={invalid}
        />,
      );
      const field = screen.getByText('Once a week').closest('[data-invalid]');
      expect(field !== null).toBe(marked);
    },
  );

  it('does not toggle when disabled', async () => {
    const onChange = vi.fn();
    render(
      <Checkbox disabled checked={false} onChange={onChange} label="Terms" />,
    );
    await userEvent.click(screen.getByText('Terms'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Checkbox props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Checkbox>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Checkbox>>().not.toHaveProperty('style');
  });
});
