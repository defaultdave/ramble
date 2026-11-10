import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Select } from './Select';

// Behaviours under test, one per decision, branch or risk:
// - the select is labelled and lists its options, with a disabled one disabled
// - a placeholder is an empty first option; without one there is none
// - the hint and error describe the select, and an error marks it invalid
// - an optional field says so
// - callers cannot restyle it

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
];

describe('Select', () => {
  it('labels the select and lists the options', () => {
    render(<Select label="Reason" options={options} />);
    const select = screen.getByLabelText('Reason');
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(screen.getByRole('option', { name: 'Beta' })).toBeDisabled();
  });

  it('puts an empty placeholder option first', () => {
    render(<Select label="Reason" options={options} placeholder="Choose" />);
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('Choose');
    expect(first).toHaveValue('');
  });

  it('describes the select by its hint and marks an error invalid', () => {
    render(
      <Select
        label="Reason"
        options={options}
        hint="Why"
        errorText="Pick one"
      />,
    );
    const select = screen.getByLabelText('Reason');
    expect(select).toBeInvalid();
    expect(select).toHaveAccessibleDescription('Why Pick one');
  });

  it('is valid with no error text, and marks an optional field', () => {
    render(<Select label="Reason" options={options} optional />);
    expect(screen.getByLabelText(/Reason/)).toBeValid();
    expect(screen.getByText('(optional)')).toBeVisible();
  });

  it('keeps its label, options, and value in the hero variant', () => {
    render(
      <Select
        label="Guests"
        options={options}
        variant="hero"
        name="guests"
        defaultValue="a"
      />,
    );
    const select = screen.getByLabelText('Guests');
    expect(select).toHaveValue('a');
    expect(select).toHaveAttribute('name', 'guests');
  });

  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof Select>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Select>>().not.toHaveProperty('style');
  });
});
