import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { CollectionForm } from './CollectionForm';
import { CollectionItems } from './CollectionItems';
import { CollectionsList } from './CollectionsList';
import { HomeModuleForm } from './HomeModuleForm';
import { HomeModulesList } from './HomeModulesList';
import {
  addOptions,
  adminStoryA11y,
  collectionRows,
  draftPick,
  heroModule,
  homeRows,
  itemRows,
  livePick,
  pickId,
  picks,
  picksModule,
  weekModule,
} from './EditorialAdmin.fixtures';

// One story per state of the home modules and collections admin: the lists with rows, empty and
// failed; the forms new, draft, published and with a refused field; the entries with and without
// an experience left to add.
const noop = () => undefined;

const meta = {
  title: 'Ops/EditorialAdmin/Sections',
  parameters: { a11y: adminStoryA11y },
  decorators: [
    (Story) => (
      <PageHeading title="Editorial">
        <Story />
      </PageHeading>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const homeForm = {
  module: heroModule,
  position: 0,
  picks,
  problems: [],
  save: noop,
} as const;

const collectionForm = {
  collection: livePick,
  problems: [],
  save: noop,
} as const;

const items = {
  collectionId: pickId,
  rows: itemRows,
  options: addOptions,
  problems: [],
  act: noop,
} as const;

export const HomeModules: Story = {
  render: () => <HomeModulesList rows={homeRows} act={noop} />,
};

export const HomeModulesEmpty: Story = {
  render: () => <HomeModulesList rows={[]} act={noop} />,
};

export const HomeModulesFailed: Story = {
  render: () => <HomeModulesList rows={[]} act={noop} failed />,
};

export const HomeHeroForm: Story = {
  render: () => <HomeModuleForm {...homeForm} />,
};

export const HomePicksForm: Story = {
  render: () => (
    <HomeModuleForm {...homeForm} module={picksModule} position={1} />
  ),
};

export const HomeHeadingOnlyForm: Story = {
  render: () => (
    <HomeModuleForm {...homeForm} module={weekModule} position={3} />
  ),
};

export const HomeFormWithProblems: Story = {
  render: () => <HomeModuleForm {...homeForm} problems={['heading', 'body']} />,
};

export const Collections: Story = {
  render: () => <CollectionsList rows={collectionRows} query={{}} />,
};

export const CollectionsEmpty: Story = {
  render: () => <CollectionsList rows={[]} query={{}} />,
};

export const CollectionsFailed: Story = {
  render: () => <CollectionsList rows={[]} query={{}} failed />,
};

export const CollectionFormPublished: Story = {
  render: () => <CollectionForm {...collectionForm} />,
};

export const CollectionFormDraft: Story = {
  render: () => <CollectionForm {...collectionForm} collection={draftPick} />,
};

export const CollectionFormNew: Story = {
  render: () => <CollectionForm {...collectionForm} collection={null} />,
};

export const CollectionFormWithProblems: Story = {
  render: () => (
    <CollectionForm
      {...collectionForm}
      problems={['title', 'slug', 'summary', 'intro']}
    />
  ),
};

export const CollectionEntries: Story = {
  render: () => <CollectionItems {...items} />,
};

export const CollectionEntriesEmpty: Story = {
  render: () => <CollectionItems {...items} rows={[]} />,
};

export const CollectionEntriesNothingToAdd: Story = {
  render: () => <CollectionItems {...items} options={[]} />,
};

export const CollectionEntriesWithProblems: Story = {
  render: () => (
    <CollectionItems {...items} problems={['experienceId', 'note']} />
  ),
};
