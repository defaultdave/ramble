import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
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

  it('keeps the caller aria-invalid when there is no error text', () => {
    render(<Input label="Email" aria-invalid="true" />);
    expect(screen.getByLabelText('Email')).toBeInvalid();
  });

  it('puts the hint above the error message after the input', () => {
    render(<Input label="Email" hint="Hint" errorText="Error" />);
    const input = screen.getByLabelText('Email');
    const hint = screen.getByText('Hint');
    const error = screen.getByText('Error');
    expect(
      input.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      hint.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

describe('Input props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Input>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Input>>().not.toHaveProperty('style');
  });
});
