import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import {
  blankValues,
  choices,
  listRows,
  nextCursorId,
  savedValues,
  savedView,
} from './ExperienceEditor.fixtures';
import { ExperienceEditView } from './ExperienceEditView';
import { ExperienceForm } from './ExperienceForm';
import { ExperienceNotice } from './ExperienceNotice';
import { ExperiencesList } from './ExperiencesList';

// One story per state of the experience editor: the list and its filters, the create form, the
// edit form with and without problems, a guide-only entry, and the notices, on a phone and a desktop.
const noop = () => undefined;
const noFilters = { status: null, hostId: null, categoryId: null };

const meta = {
  title: 'Ops/ExperienceEditor',
  component: ExperienceForm,
  args: { action: noop, values: blankValues, choices },
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
      <PageHeading title="Experiences">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta<typeof ExperienceForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const ListMobile: Story = {
  globals: mobile,
  render: () => (
    <ExperiencesList
      rows={listRows}
      query={{}}
      filters={noFilters}
      hosts={choices.hosts}
      categories={choices.categories}
      cursor={null}
      nextCursor={nextCursorId}
    />
  ),
};
export const ListFilteredDesktop: Story = {
  globals: desktop,
  render: () => (
    <ExperiencesList
      rows={listRows.slice(1)}
      query={{ status: 'draft', host: choices.hosts[1]?.value ?? '' }}
      filters={{
        status: 'draft',
        hostId: choices.hosts[1]?.value ?? null,
        categoryId: null,
      }}
      hosts={choices.hosts}
      categories={choices.categories}
      cursor={nextCursorId}
      nextCursor={null}
    />
  ),
};
export const ListEmpty: Story = {
  globals: mobile,
  render: () => (
    <ExperiencesList
      rows={[]}
      query={{ status: 'paused' }}
      filters={{ ...noFilters, status: 'paused' }}
      hosts={choices.hosts}
      categories={choices.categories}
      cursor={null}
      nextCursor={null}
    />
  ),
};

export const CreateMobile: Story = { globals: mobile };
export const CreateDesktop: Story = { globals: desktop };
export const CreateWithProblems: Story = {
  globals: mobile,
  args: { problems: ['hostId', 'name', 'categoryId', 'adultPrice'] },
};

export const EditMobile: Story = {
  globals: mobile,
  render: () => (
    <ExperienceEditView view={savedView} choices={choices} save={noop} />
  ),
};
export const EditDesktop: Story = {
  globals: desktop,
  render: () => (
    <ExperienceEditView view={savedView} choices={choices} save={noop} />
  ),
};
export const EditWithProblems: Story = {
  globals: mobile,
  render: () => (
    <ExperienceEditView
      view={savedView}
      choices={choices}
      problems={['slug', 'minAge', 'weatherPolicy', 'childPrice']}
      save={noop}
    />
  ),
};
export const EditGuideOnly: Story = {
  globals: mobile,
  render: () => (
    <ExperienceEditView
      view={{
        ...savedView,
        status: 'guide_only',
        content: { ...savedValues, linkOutUrl: null },
      }}
      choices={choices}
      problems={['linkOutUrl']}
      save={noop}
    />
  ),
};

export const NoticeCreated: Story = {
  globals: mobile,
  render: () => <ExperienceNotice code="created" />,
};
export const NoticeUnchanged: Story = {
  globals: mobile,
  render: () => <ExperienceNotice code="unchanged" />,
};
export const NoticeInvalid: Story = {
  globals: mobile,
  render: () => <ExperienceNotice code="invalid" />,
};
export const NoticeReferenceMissing: Story = {
  globals: mobile,
  render: () => <ExperienceNotice code="reference_missing" />,
};
