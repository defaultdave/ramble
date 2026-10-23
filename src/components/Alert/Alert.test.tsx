import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, type AlertTone } from './Alert';

describe('Alert', () => {
  it.each([
    ['info', 'status'],
    ['success', 'status'],
    ['warning', 'alert'],
    ['danger', 'alert'],
  ] satisfies [AlertTone, string][])('%s uses role %s', (tone, role) => {
    render(<Alert tone={tone} title="Heads up" />);
    expect(screen.getByRole(role)).toHaveTextContent('Heads up');
  });

  it('renders body and action', () => {
    render(
      <Alert
        tone="danger"
        title="Payment failed"
        body="Your card was declined."
        action={<button type="button">Try again</button>}
      />,
    );
    expect(screen.getByText('Your card was declined.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
