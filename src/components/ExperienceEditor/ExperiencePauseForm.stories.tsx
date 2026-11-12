import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { pauseNoticeFor } from '@/lib/experiencePause';
import { savedView } from './ExperienceEditor.fixtures';
import { ExperiencePauseForm } from './ExperiencePauseForm';

// One story per state of the pause control: live offers Pause, paused offers Unpause, and the notice after each, on a phone and a desktop.
const noop = () => undefined;

const meta = {
  title: 'Ops/ExperiencePauseForm',
  component: ExperiencePauseForm,
  args: {
    experienceId: savedView.id,
    status: 'live',
    pause: noop,
    unpause: noop,
  },
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
      <PageHeading title={savedView.content.name}>
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof ExperiencePauseForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const LiveMobile: Story = { globals: mobile };
export const LiveDesktop: Story = { globals: desktop };
export const PausedMobile: Story = {
  globals: mobile,
  args: { status: 'paused' },
};
export const PausedDesktop: Story = {
  globals: desktop,
  args: { status: 'paused' },
};
export const PausedNoticeMobile: Story = {
  globals: mobile,
  args: { status: 'paused' },
  render: (args) => (
    <>
      <ActionNotice notice={pauseNoticeFor('paused')} />
      <ExperiencePauseForm {...args} />
    </>
  ),
};
