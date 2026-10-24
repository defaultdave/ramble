import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
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

describe('Alert props', () => {
  it('rejects className and style', () => {
    // Primitives own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof Alert>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Alert>>().not.toHaveProperty('style');
  });
});
