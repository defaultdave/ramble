import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { maxEmailAddressLength } from '@/lib/email/address';
import { EmailField } from './EmailField';

// Behaviours under test: the field is a required email input named as asked, limited to the longest
// address, with autofill off; a hint and a refusal text show with it.

describe('EmailField', () => {
  it('is a required, length-limited email input with autofill off', () => {
    render(<EmailField name="email" label="Email address" hint="A hint." />);

    const field = screen.getByLabelText(/Email address/);
    expect(field).toHaveAttribute('name', 'email');
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveAttribute('maxlength', String(maxEmailAddressLength));
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toBeRequired();
    expect(screen.getByText('A hint.')).toBeInTheDocument();
  });

  it('shows a refusal on the field', () => {
    render(<EmailField name="email" label="Email address" errorText="Bad." />);

    expect(screen.getByLabelText(/Email address/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('Bad.')).toBeInTheDocument();
  });
});
