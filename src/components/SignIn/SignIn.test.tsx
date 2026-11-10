import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignInFormState } from '@/lib/signIn';
import { ConfirmSignIn } from './ConfirmSignIn';
import { SignInForm } from './SignInForm';
import { SignInProblem } from './SignInProblem';

// Behaviours under test, one per decision, branch or risk:
// - the form asks for one labelled, required email, carries the destination as a hidden field, and sends what was typed to the action
// - an invalid address is marked on the field with a message and takes focus
// - a counted-out request names the wait (singular and plural) and keeps the form
// - a failed request shows its notice and keeps the form with what was typed
// - a sent link replaces the form with the check-your-email notice naming the address, and a link back that keeps the destination
// - the button shows pending and blocks a second press while the action runs
// - each link problem shows its own notice
// - the confirm page shows one button that posts the token and destination to the confirm address, and the page itself holds no link to it

const action =
  vi.fn<
    (previous: SignInFormState, formData: FormData) => Promise<SignInFormState>
  >();

beforeEach(() => {
  vi.resetAllMocks();
});

async function submitWith(reply: SignInFormState, next = '/') {
  action.mockResolvedValue(reply);
  const user = userEvent.setup();
  render(<SignInForm action={action} next={next} />);
  await user.type(screen.getByLabelText('Email'), 'sam@example.com');
  await user.click(screen.getByRole('button', { name: 'Email me a link' }));
}

describe('the sign-in form', () => {
  it('asks for one required email and carries the destination', () => {
    const { container } = render(
      <SignInForm action={action} next="/account" />,
    );

    expect(screen.getByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(container.querySelector('input[name="next"]')).toHaveValue(
      '/account',
    );
    expect(
      screen.getByRole('button', { name: 'Email me a link' }),
    ).toBeEnabled();
  });

  it('sends what was typed and the destination to the action', async () => {
    await submitWith({ status: 'sent', email: 'sam@example.com' }, '/account');

    const [, data] = action.mock.calls[0] ?? [];
    expect(data?.get('email')).toBe('sam@example.com');
    expect(data?.get('next')).toBe('/account');
  });

  it('marks an invalid address on the field and moves focus to it', async () => {
    await submitWith({ status: 'invalid', email: 'sam' });

    const field = await screen.findByLabelText('Email');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Enter an email address/)).toBeInTheDocument();
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
  });

  it.each([
    [1, 'Try again in about 1 minute.'],
    [30, 'Try again in about 30 minutes.'],
  ])('names a wait of %s minutes', async (retryAfterMinutes, text) => {
    await submitWith({
      status: 'rate_limited',
      email: 'sam@example.com',
      retryAfterMinutes,
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
  });

  it('shows a failure and keeps the form with the address', async () => {
    await submitWith({ status: 'failed', email: 'sam@example.com' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not send a link',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com');
  });

  it('replaces the form with the check-your-email notice, naming the address', async () => {
    await submitWith({ status: 'sent', email: 'sam@example.com' }, '/account');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check your email',
    );
    expect(screen.getByRole('status')).toHaveTextContent('sam@example.com');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Use a different email' }),
    ).toHaveAttribute('href', '/sign-in?next=%2Faccount');
  });

  it('shows pending while the action runs and ignores a second press', async () => {
    let finish: (state: SignInFormState) => void = () => undefined;
    action.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<SignInForm action={action} next="/" />);
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    const button = screen.getByRole('button', { name: 'Email me a link' });

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);

    finish({ status: 'sent', email: 'sam@example.com' });
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

describe('a link problem', () => {
  it.each([
    ['link_invalid', 'alert', 'expired or was already used'],
    ['failed', 'alert', 'We could not sign you in'],
  ] as const)('%s shows its notice', (problem, role, text) => {
    render(<SignInProblem problem={problem} />);

    expect(screen.getByRole(role)).toHaveTextContent(text);
  });
});

describe('the confirm page', () => {
  it('posts the token and destination to the confirm address from one button', () => {
    const { container } = render(
      <ConfirmSignIn token="AbC123" next="/account" />,
    );

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/auth/confirm-sign-in');
    expect(container.querySelector('input[name="token"]')).toHaveValue(
      'AbC123',
    );
    expect(container.querySelector('input[name="next"]')).toHaveValue(
      '/account',
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('has no link that would use the token when followed', () => {
    render(<ConfirmSignIn token="AbC123" next="/" />);

    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
