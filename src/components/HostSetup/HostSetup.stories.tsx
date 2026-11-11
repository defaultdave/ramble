import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import type { HostDetail, HostListRow } from '@/lib/hostSetup';
import { HostDetailView } from './HostDetailView';
import { HostForm } from './HostForm';
import { HostNotice } from './HostNotice';
import { HostsTable } from './HostsTable';

// One story per state of host setup: the list, each form state, the detail by agreement standing, and the notices, on a phone and a desktop.
const noop = () => undefined;
const agreement = {
  id: '7c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  version: 3,
  title: 'Host agreement',
};
const host = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  name: 'Spoke & Saddle',
  slug: 'spoke-and-saddle',
  description: 'Two cycling teachers who lead small, unhurried rides.',
  timeZone: 'America/New_York',
  notificationEmail: 'bookings@spokeandsaddle.example',
};
const owners = [
  {
    userId: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    email: 'owner@spokeandsaddle.example',
  },
];
const detail = (overrides: Partial<HostDetail> = {}): HostDetail => ({
  host,
  owners,
  agreement,
  acceptances: [],
  ...overrides,
});
const rows: HostListRow[] = [
  {
    id: host.id,
    name: host.name,
    slug: host.slug,
    timeZone: host.timeZone,
    ownerEmails: ['owner@spokeandsaddle.example'],
    acceptance: 'accepted',
  },
  {
    id: '2a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    name: 'Second Pour',
    slug: 'second-pour',
    timeZone: 'America/New_York',
    ownerEmails: [],
    acceptance: 'missing',
  },
  {
    id: '3a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    name: 'Thimble & Thread',
    slug: 'thimble-and-thread',
    timeZone: 'America/New_York',
    ownerEmails: ['sam@thimble.example'],
    acceptance: 'outdated',
  },
];
const actions = { save: noop, accept: noop, resendInvite: noop };

const meta = {
  title: 'Ops/HostSetup',
  component: HostForm,
  args: { action: noop },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme.
        rules: [
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <PageHeading title="Hosts">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof HostForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const ListMobile: Story = {
  globals: mobile,
  render: () => (
    <HostsTable rows={rows} query={{}} cursor={null} nextCursor="next" />
  ),
};
export const ListDesktop: Story = {
  globals: desktop,
  render: () => (
    <HostsTable rows={rows} query={{}} cursor="prev" nextCursor={null} />
  ),
};
export const ListEmpty: Story = {
  globals: mobile,
  render: () => (
    <HostsTable rows={[]} query={{}} cursor={null} nextCursor={null} />
  ),
};

export const CreateMobile: Story = {
  globals: mobile,
  args: { agreement },
};
export const CreateDesktop: Story = {
  globals: desktop,
  args: { agreement },
};
export const CreateWithoutAgreement: Story = {
  globals: mobile,
  args: { agreement: null },
};
export const CreateWithProblems: Story = {
  globals: mobile,
  args: { agreement, problems: ['name', 'timeZone', 'ownerEmail'] },
};

export const DetailNotAccepted: Story = {
  globals: mobile,
  render: () => (
    <HostDetailView detail={detail()} problems={[]} actions={actions} />
  ),
};
export const DetailAcceptedDesktop: Story = {
  globals: desktop,
  render: () => (
    <HostDetailView
      detail={detail({
        acceptances: [
          {
            legalDocumentId: agreement.id,
            version: 3,
            acceptedAt: new Date('2026-11-01T15:00:00Z'),
          },
        ],
      })}
      problems={[]}
      actions={actions}
    />
  ),
};
export const DetailOlderVersionAccepted: Story = {
  globals: mobile,
  render: () => (
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
    />
  ),
};
export const DetailNoAgreementPublished: Story = {
  globals: mobile,
  render: () => (
    <HostDetailView
      detail={detail({ agreement: null })}
      problems={[]}
      actions={actions}
    />
  ),
};
export const DetailNoOwner: Story = {
  globals: mobile,
  render: () => (
    <HostDetailView
      detail={detail({ owners: [] })}
      problems={['name']}
      actions={actions}
    />
  ),
};

export const NoticeCreated: Story = {
  globals: mobile,
  render: () => <HostNotice code="created" />,
};
export const NoticeInviteFailed: Story = {
  globals: mobile,
  render: () => <HostNotice code="created_invite_failed" />,
};
export const NoticeStaleAgreement: Story = {
  globals: mobile,
  render: () => <HostNotice code="stale_agreement" />,
};
export const NoticeRateLimited: Story = {
  globals: mobile,
  render: () => <HostNotice code="rate_limited" />,
};
