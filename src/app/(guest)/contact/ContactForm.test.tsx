import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import { supportTopicLabels } from '@/lib/support';
import type { SupportFormState, SupportFormValues } from '@/lib/support';

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('@/server/actions/contact', () => ({
  submitSupportRequest: mocks.submit,
}));

import { ContactForm } from './ContactForm';

// Behaviours under test, one per decision, branch or risk:
// - the form has a labelled field for each thing asked, a topic list, the guard fields, and a send button
// - a submit sends what was typed and the guard token to the action
// - field errors appear beside their fields, mark them invalid, and move focus to the first
// - a refused form comes back with what the guest typed
// - rate limited, expired, and failed each show their own notice and keep the form
// - sent replaces the form with a confirmation that links back to help

const values: SupportFormValues = {
  name: 'Pat Smith',
  email: 'pat@example.com',
  topic: 'refund',
  message: 'I was charged twice.',
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function submit(reply: SupportFormState) {
  mocks.submit.mockResolvedValue(reply);
  const user = userEvent.setup();
  render(<ContactForm token="123.sig" />);
  await user.type(screen.getByLabelText('Your name'), 'Pat Smith');
  await user.type(screen.getByLabelText('Your email'), 'pat@example.com');
  await user.selectOptions(
    screen.getByLabelText('What is this about?'),
    'refund',
  );
  await user.type(
    screen.getByLabelText('Your message'),
    'I was charged twice.',
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('the contact form', () => {
  it('asks for a name, an email, a topic, and a message', () => {
    render(<ContactForm token="123.sig" />);

    expect(screen.getByLabelText('Your name')).toBeRequired();
    expect(screen.getByLabelText('Your email')).toHaveAttribute(
      'type',
      'email',
    );
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Choose one', ...Object.values(supportTopicLabels)]);
    expect(screen.getByLabelText('Your message').tagName).toBe('TEXTAREA');
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).toBeInTheDocument();
  });

  it('sends the typed fields and the guard fields to the action', async () => {
    await submit({ status: 'sent' });

    const [, data] = mocks.submit.mock.calls[0] as [unknown, FormData];
    expect(Object.fromEntries(data)).toEqual({
      ...values,
      [FORM_TOKEN_FIELD]: '123.sig',
      [HONEYPOT_FIELD]: '',
    });
  });

  it('shows field errors beside their fields, marks them, and focuses the first', async () => {
    await submit({
      status: 'invalid',
      values: { ...values, email: 'nope' },
      errors: { email: 'Enter an email address like name@example.com.' },
    });

    const email = await screen.findByLabelText('Your email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(
      expect.stringContaining('Enter an email address') as string,
    );
    await waitFor(() => {
      expect(email).toHaveFocus();
    });
    expect(screen.getByLabelText('Your name')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('brings back what the guest typed after a refusal', async () => {
    await submit({
      status: 'invalid',
      values: { ...values, email: 'nope' },
      errors: { email: 'Enter an email address like name@example.com.' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Your email')).toHaveValue('nope');
    });
    expect(screen.getByLabelText('Your message')).toHaveValue(values.message);
    expect(screen.getByLabelText('What is this about?')).toHaveValue('refund');
  });

  it.each([
    ['rate_limited', 'You have sent a few messages already'],
    ['expired', 'This form has been open for a long time'],
    ['failed', 'Your message was not sent'],
  ] as const)(
    'shows the %s notice and keeps the form',
    async (status, title) => {
      await submit({ status, values });

      expect(await screen.findByText(title)).toBeVisible();
      await waitFor(() => {
        expect(
          screen.getByText(title).closest('[tabindex="-1"]'),
        ).toHaveFocus();
      });
      expect(
        screen.getByRole('button', { name: 'Send message' }),
      ).toBeVisible();
    },
  );

  it('replaces the form with a confirmation that links back to help', async () => {
    await submit({ status: 'sent' });

    expect(await screen.findByText(/your message is on its way/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to the help center' }),
    ).toHaveAttribute('href', '/help');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});
