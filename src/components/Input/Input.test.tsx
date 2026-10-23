import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('labels the input', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('describes the input by its hint', () => {
    render(<Input label="Email" hint="We send your tickets here" />);
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'We send your tickets here',
    );
  });

  it('wires error text and marks the input invalid', () => {
    render(<Input label="Email" errorText="Enter a valid email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('Enter a valid email');
  });

  it('describes by hint, error, and the caller id together', () => {
    render(
      <Input
        label="Email"
        hint="Hint"
        errorText="Error"
        aria-describedby="extra"
      />,
    );
    expect(
      screen.getByLabelText('Email').getAttribute('aria-describedby'),
    ).toMatch(/-hint .*-error extra$/);
  });

  it('is valid when there is no error text', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeValid();
  });

  it('marks an optional field', () => {
    render(<Input label="Notes" optional />);
    expect(screen.getByText('(optional)')).toBeVisible();
  });

  it('keeps a caller id on the input', () => {
    render(<Input label="Email" id="email" />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'email');
  });
});
