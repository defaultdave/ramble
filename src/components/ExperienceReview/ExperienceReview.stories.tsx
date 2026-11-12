import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { reviewNoticeText } from '@/lib/experienceReview';
import {
  needsAltView,
  nextCursorId,
  queueRows,
  reviewView,
} from './ExperienceReview.fixtures';
import { ExperienceReviewView } from './ExperienceReviewView';
import { ReviewQueue } from './ReviewQueue';

// One story per state of the review pages: the queue with rows, paged and empty, the review page
// ready to decide, held up by a photo, refused with the photos named, and for an experience that
// is not in review, on a phone and a desktop.
const noop = () => undefined;

const meta = {
  title: 'Ops/ExperienceReview',
  component: ExperienceReviewView,
  args: { view: reviewView, approve: noop, reject: noop },
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
      <PageHeading title="Review queue">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof ExperienceReviewView>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const QueueMobile: Story = {
  globals: mobile,
  render: () => (
    <ReviewQueue
      rows={queueRows}
      query={{}}
      cursor={null}
      nextCursor={nextCursorId}
    />
  ),
};
export const QueueDesktop: Story = {
  globals: desktop,
  render: () => (
    <ReviewQueue rows={queueRows} query={{}} cursor={null} nextCursor={null} />
  ),
};
export const QueueEmpty: Story = {
  globals: mobile,
  render: () => (
    <ReviewQueue rows={[]} query={{}} cursor={null} nextCursor={null} />
  ),
};
export const ReadyToDecideMobile: Story = { globals: mobile };
export const ReadyToDecideDesktop: Story = { globals: desktop };
export const HeldUpByPhotoMobile: Story = {
  globals: mobile,
  args: { view: needsAltView },
};
export const RefusedNamingPhotosDesktop: Story = {
  globals: desktop,
  args: { view: needsAltView },
  render: (args) => (
    <>
      <ActionNotice notice={reviewNoticeText('alt_missing', ['2'])} />
      <ExperienceReviewView {...args} />
    </>
  ),
};
export const NotInReviewMobile: Story = {
  globals: mobile,
  args: { view: { ...reviewView, status: 'live' } },
};
export const ApprovedNoticeMobile: Story = {
  globals: mobile,
  render: () => (
    <>
      <ActionNotice notice={reviewNoticeText('approved', [])} />
      <ReviewQueue rows={[]} query={{}} cursor={null} nextCursor={null} />
    </>
  ),
};
