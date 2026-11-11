import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import type {
  PrivateSessionFormState,
  PrivateSessionFormValues,
} from '@/lib/privateSession';

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('@/server/actions/privateSession', () => ({
  requestPrivateSession: mocks.submit,
}));

import { PrivateSessionForm } from './PrivateSessionForm';

// Behaviours under test, one per decision, branch or risk:
// - the form has a labelled field for each thing asked, the optional message marked, the guard fields, and a send button
// - the earliest date is today in New York, passed in by the page
// - a submit sends what was typed, the experience id, and the guard token to the action
// - a refusal shows an error summary that takes focus and links to each refused field
// - field errors appear beside their fields and mark them invalid
// - a refused form comes back with what the guest typed
// - rate limited, expired, and failed each show their own notice, which takes focus, and keep the form
// - sent replaces the form with a confirmation that links back to the experience

const values: PrivateSessionFormValues = {
  date: '2099-01-15',
  groupSize: '12',
  budget: '1200',
  name: 'Pat Smith',
  email: 'pat@example.com',
  message: 'A birthday.',
};

const experienceId = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const experienceHref = `/experiences/pasta-night-${experienceId}`;

beforeEach(() => {
  vi.resetAllMocks();
});

const renderForm = () =>
  render(
    <PrivateSessionForm
      token="123.sig"
      experienceId={experienceId}
      experienceHref={experienceHref}
      minDate="2026-11-10"
    />,
  );

async function submit(reply: PrivateSessionFormState) {
  mocks.submit.mockResolvedValue(reply);
  const user = userEvent.setup();
  renderForm();
  await user.type(screen.getByLabelText('Preferred date'), values.date);
  await user.type(screen.getByLabelText('Group size'), values.groupSize);
  await user.type(screen.getByLabelText('Budget'), values.budget);
  await user.type(screen.getByLabelText('Your name'), values.name);
  await user.type(screen.getByLabelText('Your email'), values.email);
  await user.type(
    screen.getByLabelText(/Anything else the host should know/),
    values.message,
  );
  await user.click(screen.getByRole('button', { name: 'Send request' }));
}

describe('the private session form', () => {
  it('asks for a date, a group size, a budget, a name, an email, and an optional message', () => {
    renderForm();

    expect(screen.getByLabelText('Preferred date')).toBeRequired();
    expect(screen.getByLabelText('Preferred date')).toHaveAttribute(
      'type',
      'date',
    );
    expect(screen.getByLabelText('Group size')).toHaveAttribute(
      'type',
      'number',
    );
    expect(screen.getByLabelText('Budget')).toBeRequired();
    expect(screen.getByLabelText('Your name')).toBeRequired();
    expect(screen.getByLabelText('Your email')).toHaveAttribute(
      'type',
      'email',
    );
    const message = screen.getByLabelText(/Anything else the host should know/);
    expect(message.tagName).toBe('TEXTAREA');
    expect(message).not.toBeRequired();
    expect(screen.getByText('(optional)')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Send request' }),
    ).toBeInTheDocument();
  });

  it('takes no date before the day the page passed in', () => {
    renderForm();

    expect(screen.getByLabelText('Preferred date')).toHaveAttribute(
      'min',
      '2026-11-10',
    );
  });

  it('sends the typed fields, the experience, and the guard fields to the action', async () => {
    await submit({ status: 'sent' });

    const [, data] = mocks.submit.mock.calls[0] as [unknown, FormData];
    expect(Object.fromEntries(data)).toEqual({
      ...values,
      experienceId,
      [FORM_TOKEN_FIELD]: '123.sig',
      [HONEYPOT_FIELD]: '',
    });
  });

  it('shows an error summary that takes focus and links to each refused field', async () => {
    await submit({
      status: 'invalid',
      values: { ...values, email: 'nope', budget: 'lots' },
      errors: {
        budget: 'Enter your budget in whole dollars, like 1200.',
        email: 'Enter an email address like name@example.com.',
      },
    });

    const summary = (await screen.findByText('Check these answers')).closest(
      '[tabindex="-1"]',
    );
    await waitFor(() => {
      expect(summary).toHaveFocus();
    });
    const links = screen
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      [
        'Budget: Enter your budget in whole dollars, like 1200.',
        '#private-session-budget',
      ],
      [
        'Your email: Enter an email address like name@example.com.',
        '#private-session-email',
      ],
    ]);
    expect(document.getElementById('private-session-budget')).toBe(
      screen.getByLabelText('Budget'),
    );
  });

  it('shows field errors beside their fields and marks only those fields', async () => {
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
    expect(screen.getByLabelText('Budget')).toHaveValue(values.budget);
    expect(screen.getByLabelText('Group size')).toHaveValue(12);
    expect(screen.getByLabelText('Preferred date')).toHaveValue(values.date);
    expect(
      screen.getByLabelText(/Anything else the host should know/),
    ).toHaveValue(values.message);
  });

  it.each([
    ['rate_limited', 'You have sent a few requests already'],
    ['expired', 'This form has been open for a long time'],
    ['failed', 'Your request was not sent'],
  ] as const)(
    'shows the %s notice, moves focus to it, and keeps the form',
    async (status, title) => {
      await submit({ status, values });

      expect(await screen.findByText(title)).toBeVisible();
      await waitFor(() => {
        expect(
          screen.getByText(title).closest('[tabindex="-1"]'),
        ).toHaveFocus();
      });
      expect(
        screen.getByRole('button', { name: 'Send request' }),
      ).toBeVisible();
    },
  );

  it('replaces the form with a confirmation that links back to the experience', async () => {
    await submit({ status: 'sent' });

    expect(await screen.findByText(/your request is on its way/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to the experience' }),
    ).toHaveAttribute('href', experienceHref);
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});
