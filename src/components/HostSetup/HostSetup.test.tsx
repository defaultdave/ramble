import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostDetail, HostListRow } from '@/lib/hostSetup';
import { HostDetailView } from './HostDetailView';
import { HostForm } from './HostForm';
import { HostNotice } from './HostNotice';
import { HostsTable } from './HostsTable';

// Behaviours under test:
// - the create form asks for the owner and offers the agreement box for the version it is given, and says so when there is none
// - the edit form is prefilled, carries the host id, has no owner field, and no agreement box
// - a field the last try refused shows its problem text and is marked invalid
// - the notice shows the one line for its code, and nothing for none
// - the list links each host, shows the owner and the agreement standing in words, and pages by link
// - the detail lists each owner with a resend button that carries the host and the owner, and shows what was accepted
// - the acceptance form carries the current version and is hidden once it is accepted or when there is none

const noop = () => undefined;
const hostId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const docId = '7c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const agreement = { id: docId, version: 3, title: 'Host agreement' };

const host = {
  id: hostId,
  name: 'Spoke & Saddle',
  slug: 'spoke-and-saddle',
  description: 'Two cycling teachers.',
  timeZone: 'America/New_York',
  notificationEmail: 'bookings@example.com',
};

const detail = (overrides: Partial<HostDetail> = {}): HostDetail => ({
  host,
  owners: [
    {
      userId: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
      email: 'owner@example.com',
    },
  ],
  agreement,
  acceptances: [],
  ...overrides,
});

const actions = { save: noop, accept: noop, resendInvite: noop };

describe('HostForm', () => {
  it('asks for the owner and offers the agreement box for the current version', () => {
    render(<HostForm action={noop} agreement={agreement} />);

    expect(screen.getByLabelText('Owner email')).toBeRequired();
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/New_York');
    const box = screen.getByRole('checkbox', {
      name: /accepted the current Host agreement \(version 3\)/,
    });
    expect(box).toHaveAttribute('name', 'acceptLegalDocumentId');
    expect(box).toHaveAttribute('value', docId);
    expect(
      screen.getByRole('button', { name: 'Create host and email owner' }),
    ).toBeInTheDocument();
  });

  it('says acceptance cannot be recorded when no agreement is published', () => {
    render(<HostForm action={noop} agreement={null} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No host agreement is published yet/),
    ).toBeInTheDocument();
  });

  it('prefills an edit, carries the host id, and has no owner field or agreement box', () => {
    const { container } = render(<HostForm action={noop} values={host} />);

    expect(screen.getByLabelText('Host name')).toHaveValue('Spoke & Saddle');
    expect(screen.getByLabelText('Address name')).toHaveValue(
      'spoke-and-saddle',
    );
    expect(screen.getByLabelText(/Description/)).toHaveValue(
      'Two cycling teachers.',
    );
    expect(container.querySelector('input[name="hostId"]')).toHaveValue(hostId);
    expect(screen.queryByLabelText('Owner email')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save host' }),
    ).toBeInTheDocument();
  });

  it('shows the problem for each field the last try refused and marks it invalid', () => {
    render(
      <HostForm
        action={noop}
        problems={['name', 'ownerEmail']}
        agreement={null}
      />,
    );

    expect(screen.getByLabelText('Host name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Owner email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByText('Enter the host name, up to 120 characters.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Time zone')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('HostNotice', () => {
  it('shows the line for its code', () => {
    render(<HostNotice code="stale_agreement" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A newer agreement was published while you were looking. Review it and try again.',
    );
  });

  it('shows nothing for no code', () => {
    const { container } = render(<HostNotice code={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('HostsTable', () => {
  const rows: HostListRow[] = [
    {
      id: hostId,
      name: 'Spoke & Saddle',
      slug: 'spoke',
      timeZone: 'UTC',
      ownerEmails: ['a@example.com'],
      acceptance: 'accepted',
    },
    {
      id: docId,
      name: 'Second Pour',
      slug: 'second',
      timeZone: 'UTC',
      ownerEmails: [],
      acceptance: 'missing',
    },
  ];

  it('links each host and says the owner and the agreement standing in words', () => {
    render(
      <HostsTable rows={rows} query={{}} cursor={null} nextCursor={null} />,
    );

    expect(
      screen.getByRole('link', { name: 'Spoke & Saddle' }),
    ).toHaveAttribute('href', `/ops/hosts/${hostId}`);
    const second = screen.getByRole('row', { name: /Second Pour/ });
    expect(within(second).getByText('None')).toBeInTheDocument();
    expect(within(second).getByText('Not accepted')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('pages by link, and says so when there are no hosts', () => {
    const { rerender } = render(
      <HostsTable rows={rows} query={{}} cursor={null} nextCursor={docId} />,
    );
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/ops/hosts?cursor=${docId}`,
    );

    rerender(
      <HostsTable rows={[]} query={{}} cursor={null} nextCursor={null} />,
    );
    expect(screen.getByText('No hosts yet')).toBeInTheDocument();
  });
});

describe('HostDetailView', () => {
  it('lists each owner with a resend button that carries the host and the owner', () => {
    const { container } = render(
      <HostDetailView detail={detail()} problems={[]} actions={actions} />,
    );

    const owners = screen.getByRole('region', { name: 'Owners' });
    expect(within(owners).getByText('owner@example.com')).toBeInTheDocument();
    expect(
      within(owners).getByRole('button', { name: 'Send a sign-in link' }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="ownerUserId"]')).toHaveValue(
      '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    );
    expect(container.querySelector('input[name="hostId"]')).toHaveValue(hostId);
  });

  it('says the host has no owner when there is none', () => {
    render(
      <HostDetailView
        detail={detail({ owners: [] })}
        problems={[]}
        actions={actions}
      />,
    );

    expect(screen.getByText('This host has no owner yet.')).toBeInTheDocument();
  });

  it('offers the current version to accept, carrying its id, when the host has not accepted it', () => {
    const { container } = render(
      <HostDetailView detail={detail()} problems={[]} actions={actions} />,
    );

    expect(screen.getByText('Not accepted')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record acceptance of version 3' }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('input[name="legalDocumentId"]'),
    ).toHaveValue(docId);
  });

  it('lists what was accepted and hides the form once the current version is accepted', () => {
    render(
      <HostDetailView
        detail={detail({
          acceptances: [
            {
              legalDocumentId: docId,
              version: 3,
              acceptedAt: new Date('2026-11-01T15:00:00Z'),
            },
          ],
        })}
        problems={[]}
        actions={actions}
      />,
    );

    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(
      screen.getByText('Version 3, accepted Sunday, November 1, 2026'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Record acceptance/ }),
    ).not.toBeInTheDocument();
  });

  it('says an older version is out of date and offers the current one', () => {
    render(
      <HostDetailView
        detail={detail({
          acceptances: [
            {
              legalDocumentId: 'older',
              version: 2,
              acceptedAt: new Date('2026-10-01T15:00:00Z'),
            },
          ],
        })}
        problems={[]}
        actions={actions}
      />,
    );

    expect(screen.getByText('Older version accepted')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record acceptance of version 3' }),
    ).toBeInTheDocument();
  });

  it('says there is no agreement to accept when none is published', () => {
    render(
      <HostDetailView
        detail={detail({ agreement: null })}
        problems={[]}
        actions={actions}
      />,
    );

    expect(screen.getByText('No agreement published')).toBeInTheDocument();
    expect(
      screen.getByText('No host agreement is published.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Record acceptance/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the record form prefilled with the problems it is given', () => {
    render(
      <HostDetailView
        detail={detail()}
        problems={['timeZone']}
        actions={actions}
      />,
    );

    expect(screen.getByLabelText('Host name')).toHaveValue('Spoke & Saddle');
    expect(screen.getByLabelText('Time zone')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
