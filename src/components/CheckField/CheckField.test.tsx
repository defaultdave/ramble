import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckField } from './CheckField';

// Behaviours under test:
// - the box is labelled, posts under its name and value, and starts as it is told
// - a problem shows as an alert under the box, and no problem shows none
// - a problem marks the box invalid and ties it to the alert; `invalid` and `describedBy` do the same for a problem shown elsewhere

describe('CheckField', () => {
  it('is a labelled native checkbox that posts its name and value', () => {
    render(<CheckField name="agree" value="v3" label="I agree" />);

    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).toHaveAttribute('name', 'agree');
    expect(box).toHaveAttribute('value', 'v3');
    expect(box).not.toBeChecked();
  });

  it('starts ticked when told to', () => {
    render(<CheckField name="agree" label="I agree" defaultChecked />);

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeChecked();
  });

  it('shows a problem as an alert, and nothing without one', () => {
    const { rerender } = render(
      <CheckField name="agree" label="I agree" problem="Tick the box." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Tick the box.');

    rerender(<CheckField name="agree" label="I agree" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ties a problem to the box with aria-invalid and aria-describedby', () => {
    render(<CheckField name="agree" label="I agree" problem="Tick the box." />);

    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Tick the box.');
    expect(screen.getByRole('alert')).toHaveAttribute('id');
  });

  it('is neither invalid nor described when there is no problem', () => {
    render(<CheckField name="agree" label="I agree" />);

    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).not.toHaveAttribute('aria-describedby');
  });

  it('takes invalid and a description from elsewhere for a group problem', () => {
    render(
      <>
        <p id="group-error">Choose a day.</p>
        <CheckField
          name="mon"
          label="Monday"
          invalid
          describedBy="group-error"
        />
      </>,
    );

    const box = screen.getByRole('checkbox', { name: 'Monday' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Choose a day.');
  });
});
