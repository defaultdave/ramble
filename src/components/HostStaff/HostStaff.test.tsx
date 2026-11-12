import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostStaffRow } from '@/lib/hostStaff';
import { HostStaff } from './HostStaff';

// Behaviours under test:
// - the page has an invite form with one required email field that says staff only look, and shows the refusal text on the field when the last try was refused
// - each staff member is a row with a sign-in link button and a removal button that each carry the person's id
// - no staff shows the empty state

const noop = () => undefined;
const actions = { invite: noop, resend: noop, revoke: noop };
const userId = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const rows: HostStaffRow[] = [{ userId, email: 'staff@example.com' }];

describe('HostStaff', () => {
  it('asks for one required email address and says what staff can do', () => {
    render(
      <HostStaff rows={rows} query={{}} problems={[]} actions={actions} />,
    );

    const field = screen.getByLabelText(/Email address/);
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('type', 'email');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/and change nothing/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Invite staff member' }),
    ).toBeInTheDocument();
  });

  it('shows the refusal on the field', () => {
    render(
      <HostStaff
        rows={rows}
        query={{}}
        problems={['email']}
        actions={actions}
      />,
    );

    expect(screen.getByLabelText(/Email address/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText(/Enter the staff member/)).toBeInTheDocument();
  });

  it('offers the link and removal on each row, carrying the person', () => {
    render(
      <HostStaff rows={rows} query={{}} problems={[]} actions={actions} />,
    );

    const row = screen.getByRole('row', { name: /staff@example.com/ });
    expect(
      within(row).getByRole('button', { name: 'Send a sign-in link' }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Remove access' }),
    ).toBeInTheDocument();
    expect(
      row.querySelectorAll(`input[name="userId"][value="${userId}"]`),
    ).toHaveLength(2);
  });

  it('shows an empty state with no staff', () => {
    render(<HostStaff rows={[]} query={{}} problems={[]} actions={actions} />);

    expect(screen.getByText('No staff yet')).toBeInTheDocument();
  });
});
