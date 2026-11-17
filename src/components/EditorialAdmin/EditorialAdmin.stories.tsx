import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { EntriesList } from './EntriesList';
import { rows } from './EditorialAdmin.fixtures';

// One story per state of the article list: with articles, empty, and a failed read.
const meta = {
  title: 'Ops/EditorialAdmin/EntriesList',
  component: EntriesList,
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
      <PageHeading title="Editorial">
        <Story />
      </PageHeading>
    ),
  ],
  args: { rows, query: {} },
} satisfies Meta<typeof EntriesList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithArticles: Story = {};

export const Empty: Story = { args: { rows: [] } };

export const LoadFailed: Story = { args: { rows: [], failed: true } };
