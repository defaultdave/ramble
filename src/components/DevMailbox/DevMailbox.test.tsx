import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MailboxMessage } from '@/lib/email/message';
import {
  MailboxList,
  MailboxMessageView,
  MailboxUnlockForm,
} from './DevMailbox';

// Behaviours under test, one per decision or branch:
// - the unlock form posts to its action with a labelled password field and a submit button
// - a denied attempt shows an alert tied to the field; a fresh form shows none
// - the list is empty-stated when there is no mail, and otherwise links each message by ID with its recipient, time, and status
// - the message view shows the headers, renders the HTML only in a fully sandboxed frame, and offers the plain text

const message: MailboxMessage = {
  id: '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10',
  recipient: 'guest@example.com',
  template: 'dev-check',
  subject: 'Ramble email check',
  status: 'captured',
  createdAt: new Date('2026-10-26T18:05:00Z'),
  html: '<p>Hello <script>alert(1)</script></p>',
  textBody: 'Hello there',
};

describe('MailboxUnlockForm', () => {
  it('has a labelled password field and a submit button', () => {
    render(<MailboxUnlockForm action={vi.fn()} denied={false} />);

    const field = screen.getByLabelText('Dev mailbox secret');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('name', 'secret');
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('maxlength', '256');
    expect(
      screen.getByRole('button', { name: 'Open mailbox' }),
    ).toHaveAttribute('type', 'submit');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a denied attempt and ties it to the field', () => {
    render(<MailboxUnlockForm action={vi.fn()} denied />);

    const field = screen.getByLabelText('Dev mailbox secret');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That secret did not match.',
    );
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription('That secret did not match.');
  });
});

describe('MailboxList', () => {
  it('says so when no email has been captured', () => {
    render(<MailboxList messages={[]} />);

    expect(
      screen.getByText('No email has been captured yet.'),
    ).toBeInTheDocument();
  });

  it('links each message by ID with its recipient, time, and status', () => {
    render(<MailboxList messages={[message]} />);

    const item = within(
      screen.getByRole('list', { name: 'Captured email' }),
    ).getByRole('listitem');
    expect(
      within(item).getByRole('link', { name: 'Ramble email check' }),
    ).toHaveAttribute('href', `/ops/mailbox/${message.id}`);
    expect(item).toHaveTextContent('To guest@example.com');
    expect(item).toHaveTextContent('Oct 26, 2026, 6:05 PM UTC');
    expect(item).toHaveTextContent('In dev mailbox');
    expect(within(item).getByText(/Oct 26/)).toHaveAttribute(
      'datetime',
      '2026-10-26T18:05:00.000Z',
    );
  });
});

describe('MailboxMessageView', () => {
  it('shows the headers', () => {
    render(<MailboxMessageView message={message} />);

    const headers = screen.getByText('To').closest('dl');
    expect(headers).toHaveTextContent('guest@example.com');
    expect(headers).toHaveTextContent('Ramble email check');
    expect(headers).toHaveTextContent('dev-check');
    expect(headers).toHaveTextContent('In dev mailbox');
  });

  it('renders the HTML in a frame with every sandbox permission withheld', () => {
    render(<MailboxMessageView message={message} />);

    const frame = screen.getByTitle('Email preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', message.html);
  });

  it('offers the plain text version', () => {
    render(<MailboxMessageView message={message} />);

    expect(screen.getByText('Plain text version')).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });
});
