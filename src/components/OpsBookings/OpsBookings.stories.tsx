import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import {
  cancelledDetail,
  confirmedDetail,
  confirmedRow,
  failedRefundDetail,
  failedRefundRow,
} from './OpsBookings.fixtures';
import { OpsBookingDetailView } from './OpsBookingDetailView';
import { OpsBookingsList } from './OpsBookingsList';

// One story per state: the list (mixed, the refund-failed queue, a search with no match, empty) and the booking page for a confirmed, a cancelled, and a refund-failed booking.

const noop = () => undefined;

const meta = {
  title: 'Ops/Bookings',
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
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const listProps = {
  rows: [confirmedRow, failedRefundRow],
  query: {},
  term: '',
  summary: '',
  cursor: null,
  nextCursor: null,
  retryRefund: noop,
};

const actions = {
  cancel: noop,
  refund: noop,
  retryRefund: noop,
  resend: noop,
  voidLinks: noop,
};

export const List: Story = {
  render: () => (
    <PageHeading title="Bookings">
      <OpsBookingsList {...listProps} />
    </PageHeading>
  ),
};

export const RefundFailedQueue: Story = {
  render: () => (
    <PageHeading title="Bookings">
      <OpsBookingsList
        {...listProps}
        rows={[failedRefundRow]}
        query={{ status: 'refund_failed' }}
      />
    </PageHeading>
  ),
};

export const SearchWithNoMatch: Story = {
  render: () => (
    <PageHeading title="Bookings">
      <OpsBookingsList
        {...listProps}
        rows={[]}
        query={{ q: 'pat@example.com' }}
        term="pat@example.com"
        summary="0 bookings for pat@example.com."
      />
    </PageHeading>
  ),
};

export const Empty: Story = {
  render: () => (
    <PageHeading title="Bookings">
      <OpsBookingsList {...listProps} rows={[]} />
    </PageHeading>
  ),
};

export const ConfirmedBooking: Story = {
  render: () => (
    <PageHeading title="RMB-ABC234">
      <OpsBookingDetailView detail={confirmedDetail} actions={actions} />
    </PageHeading>
  ),
};

export const CancelledBooking: Story = {
  render: () => (
    <PageHeading title="RMB-XYZ789">
      <OpsBookingDetailView detail={cancelledDetail} actions={actions} />
    </PageHeading>
  ),
};

export const RefundFailedBooking: Story = {
  render: () => (
    <PageHeading title="RMB-XYZ789">
      <OpsBookingDetailView detail={failedRefundDetail} actions={actions} />
    </PageHeading>
  ),
};
