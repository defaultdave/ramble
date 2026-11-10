import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Textarea } from '@/components/Textarea';
import { Field } from './Field';

// Behaviours under test, one per decision, branch or risk:
// - the frame labels its control, and shows the optional marker, hint, and error only when given
// - Input, Select, and Textarea all get the same frame: label, control, hint, then error, wired to the control

describe('Field', () => {
  it('shows only what it is given', () => {
    render(
      <Field fieldId="f" label="Name">
        <input id="f" />
      </Field>,
    );
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
    expect(document.getElementById('f-hint')).toBeNull();
    expect(document.getElementById('f-error')).toBeNull();
  });

  it('gives the hint and error the ids the control points at', () => {
    render(
      <Field fieldId="f" label="Name" hint="Hint" errorText="Error" optional>
        <input id="f" />
      </Field>,
    );
    expect(document.getElementById('f-hint')).toHaveTextContent('Hint');
    expect(document.getElementById('f-error')).toHaveTextContent('Error');
    expect(screen.getByText('(optional)')).toBeVisible();
  });
});

describe('the controls built on Field', () => {
  const controls = {
    Input: <Input label="Note" hint="Hint" errorText="Error" optional />,
    Select: (
      <Select
        label="Note"
        hint="Hint"
        errorText="Error"
        optional
        options={[{ value: 'a', label: 'A' }]}
      />
    ),
    Textarea: <Textarea label="Note" hint="Hint" errorText="Error" optional />,
  };

  it.each(Object.entries(controls))(
    '%s lays out label, control, hint, error and describes its control by them',
    (_name, element) => {
      render(element);
      const control = screen.getByLabelText(/Note/);
      expect(control).toHaveAccessibleDescription('Hint Error');
      expect(control).toBeInvalid();
      const frame = document.querySelector('label')?.parentElement;
      const parts = Array.from(frame?.children ?? []).map((child) =>
        child.tagName === 'P' ? child.textContent : child.tagName,
      );
      expect(parts[0]).toBe('LABEL');
      expect(parts.slice(2)).toEqual(['Hint', 'Error']);
    },
  );
});
