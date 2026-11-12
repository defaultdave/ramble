import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuditViewRow, StaffRow } from '@/lib/staffAdmin';
import { AuditView } from './AuditView';
import { StaffView } from './StaffView';

// Behaviours under test:
// - the staff view has an invite form with one required email field, and shows the refusal text on the field when the last try was refused
// - an ops row offers a sign-in link and a removal button that each carry the person's id; an admin row offers neither
// - no staff shows the empty state
// - the audit view asks for a day with a date field set to the day shown, and lists each row's time, actor, action, subject and details
// - a full audit page links to the next page, and an empty day says nothing was recorded

const noop = () => undefined;
const actions = { invite: noop, resend: noop, revoke: noop };
const ownerId = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const adminId = '2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const staff: StaffRow[] = [
  { userId: ownerId, email: 'ops@example.com', role: 'ops' },
  { userId: adminId, email: 'admin@example.com', role: 'admin' },
];

describe('StaffView', () => {
  it('asks for one required email address', () => {
    render(
      <StaffView
        rows={staff}
        query={{}}
        emailProblem={false}
        actions={actions}
      />,
    );

    const field = screen.getByLabelText(/Email address/);
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('type', 'email');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByRole('button', { name: 'Invite staff member' }),
    ).toBeInTheDocument();
  });

  it('shows the refusal on the field', () => {
    render(
      <StaffView rows={staff} query={{}} emailProblem actions={actions} />,
    );

    expect(screen.getByLabelText(/Email address/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText(/Enter the staff member/)).toBeInTheDocument();
  });

  it('offers the link and removal for ops rows only, each carrying the person', () => {
    render(
      <StaffView
        rows={staff}
        query={{}}
        emailProblem={false}
        actions={actions}
      />,
    );

    const opsRow = screen.getByRole('row', { name: /ops@example.com/ });
    const adminRow = screen.getByRole('row', { name: /admin@example.com/ });
    expect(
      within(opsRow).getByRole('button', { name: 'Send a sign-in link' }),
    ).toBeInTheDocument();
    expect(
      within(opsRow).getByRole('button', { name: 'Remove access' }),
    ).toBeInTheDocument();
    expect(
      opsRow.querySelectorAll(`input[name="userId"][value="${ownerId}"]`),
    ).toHaveLength(2);
    expect(within(adminRow).queryByRole('button')).toBeNull();
    expect(within(adminRow).getByText('Admin')).toBeInTheDocument();
  });

  it('shows an empty state with no staff', () => {
    render(
      <StaffView rows={[]} query={{}} emailProblem={false} actions={actions} />,
    );

    expect(screen.getByText('No staff yet')).toBeInTheDocument();
  });
});

describe('AuditView', () => {
  const rows: AuditViewRow[] = [
    {
      id: '7',
      time: '09:05:03 UTC',
      actor: `user ${ownerId}`,
      action: 'role.granted',
      subject: `auth_user ${adminId}`,
      details: 'role: ops',
    },
  ];

  it('asks for a day and lists each row', () => {
    render(
      <AuditView
        day="2026-11-11"
        rows={rows}
        query={{ day: '2026-11-11' }}
        cursor={null}
        nextCursor={null}
      />,
    );

    expect(screen.getByLabelText('Day (UTC)')).toHaveValue('2026-11-11');
    const row = screen.getByRole('row', { name: /role.granted/ });
    for (const text of [
      '09:05:03 UTC',
      `user ${ownerId}`,
      'role.granted',
      `auth_user ${adminId}`,
      'role: ops',
    ]) {
      expect(within(row).getByText(text)).toBeInTheDocument();
    }
  });

  it('links to the next page when there is one, keeping the day', () => {
    render(
      <AuditView
        day="2026-11-11"
        rows={rows}
        query={{ day: '2026-11-11' }}
        cursor={null}
        nextCursor="7"
      />,
    );

    const next = screen.getByRole('link', { name: /next/i });
    expect(next).toHaveAttribute('href', expect.stringContaining('cursor=7'));
    expect(next).toHaveAttribute(
      'href',
      expect.stringContaining('day=2026-11-11'),
    );
  });

  it('says nothing was recorded for an empty day', () => {
    render(
      <AuditView
        day="2026-11-11"
        rows={[]}
        query={{}}
        cursor={null}
        nextCursor={null}
      />,
    );

    expect(
      screen.getByText('Nothing was recorded on this day'),
    ).toBeInTheDocument();
  });
});
