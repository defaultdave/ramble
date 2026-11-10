import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Textarea } from './Textarea';

// Behaviours under test, one per decision, branch or risk:
// - the textarea is labelled, four rows by default, and takes a row count and the native limits
// - the hint and error describe it, and an error marks it invalid
// - an optional field says so
// - callers cannot restyle it

describe('Textarea', () => {
  it('labels the textarea and shows four rows unless told otherwise', () => {
    const { rerender } = render(<Textarea label="Note" />);
    expect(screen.getByLabelText('Note')).toHaveAttribute('rows', '4');
    rerender(<Textarea label="Note" rows={8} maxLength={500} />);
    expect(screen.getByLabelText('Note')).toHaveAttribute('rows', '8');
    expect(screen.getByLabelText('Note')).toHaveAttribute('maxlength', '500');
  });

  it('describes the textarea by its hint and marks an error invalid', () => {
    render(<Textarea label="Note" hint="Up to 500" errorText="Write a note" />);
    const textarea = screen.getByLabelText('Note');
    expect(textarea).toBeInvalid();
    expect(textarea).toHaveAccessibleDescription('Up to 500 Write a note');
  });

  it('is valid with no error text, and marks an optional field', () => {
    render(<Textarea label="Note" optional />);
    expect(screen.getByLabelText(/Note/)).toBeValid();
    expect(screen.getByText('(optional)')).toBeVisible();
  });

  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof Textarea>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Textarea>>().not.toHaveProperty('style');
  });
});
