import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HostExperiences } from './HostExperiences';
import { none, several } from './HostExperiences.fixtures';

// The host's own experiences, read only, at the phone width.
const meta = {
  title: 'Host/HostExperiences',
  component: HostExperiences,
  args: { view: several },
  parameters: {
    a11y: {
      config: {
        rules: [
          // Every story renders the page twice, once per color scheme, so a landmark or an id appears twice.
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
          { id: 'landmark-unique', enabled: false },
          // PageHeading is a header, and a story shows it outside the page's main landmark.
          { id: 'landmark-banner-is-top-level', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
        ],
      },
    },
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof HostExperiences>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryStatus: Story = {};
export const NoExperiencesYet: Story = { args: { view: none } };
