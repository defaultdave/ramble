import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import { GuideLinksForm } from './GuideLinksForm';
import { GuidesList } from './GuidesList';
import { LegalDocsList } from './LegalDocsList';
import { LegalDraftForm } from './LegalDraftForm';
import { LegalVersions } from './LegalVersions';
import { PageCopyForm } from './PageCopyForm';
import { PageCopyList } from './PageCopyList';
import { TaxonomyLists } from './TaxonomyLists';
import { TaxonomyTermForm } from './TaxonomyTermForm';
import { adminStoryA11y } from './EditorialAdmin.fixtures';
import {
  bakingId,
  categoryRows,
  draftVersion,
  guideId,
  guideRows,
  hikingCopy,
  hikingId,
  legalDocRows,
  legalVersionRows,
  neighborhoodRows,
  pageCategoryRows,
  pageNeighborhoodRows,
} from './EditorialContent.fixtures';

// One story per state of the page copy, guide entries, legal documents and categories and
// neighborhoods admin: the lists with rows, empty and failed; the forms new, draft, published and
// with a refused field; the taxonomy lists with a retired row and with the last active row blocked.
const noop = () => undefined;

const meta = {
  title: 'Ops/EditorialAdmin/Content',
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

export const PageCopy: Story = {
  render: () => (
    <PageCopyList
      categories={pageCategoryRows}
      neighborhoods={pageNeighborhoodRows}
      query={{}}
    />
  ),
};

export const PageCopyEmpty: Story = {
  render: () => <PageCopyList categories={[]} neighborhoods={[]} query={{}} />,
};

export const PageCopyFailed: Story = {
  render: () => (
    <PageCopyList categories={[]} neighborhoods={[]} query={{}} failed />
  ),
};

const pageForm = {
  kind: 'category',
  targetId: hikingId,
  page: hikingCopy,
  problems: [],
  save: noop,
} as const;

export const PageCopyFormPublished: Story = {
  render: () => <PageCopyForm {...pageForm} />,
};

export const PageCopyFormDraft: Story = {
  render: () => (
    <PageCopyForm
      {...pageForm}
      page={{ ...hikingCopy, status: 'draft', publishedAt: null }}
    />
  ),
};

export const PageCopyFormNoCopyYet: Story = {
  render: () => <PageCopyForm {...pageForm} page={null} />,
};

export const PageCopyFormWithProblems: Story = {
  render: () => (
    <PageCopyForm
      {...pageForm}
      problems={['heading', 'metaDescription', 'intro', 'body']}
    />
  ),
};

export const Guides: Story = {
  render: () => (
    <GuidesList rows={guideRows} query={{}} cursor={null} nextCursor={null} />
  ),
};

export const GuidesEmpty: Story = {
  render: () => (
    <GuidesList rows={[]} query={{}} cursor={null} nextCursor={null} />
  ),
};

export const GuidesFailed: Story = {
  render: () => (
    <GuidesList rows={[]} query={{}} cursor={null} nextCursor={null} failed />
  ),
};

const guideForm = {
  experienceId: guideId,
  linkOutUrl: 'https://quill-and-ink-press.example.com/classes/letterpress',
  affiliateUrl: null,
  problems: [],
  save: noop,
} as const;

export const GuideLinks: Story = {
  render: () => <GuideLinksForm {...guideForm} />,
};

export const GuideLinksWithAffiliate: Story = {
  render: () => (
    <GuideLinksForm
      {...guideForm}
      affiliateUrl="https://quill-and-ink-press.example.com/classes?ref=ramble"
    />
  ),
};

export const GuideLinksWithProblems: Story = {
  render: () => (
    <GuideLinksForm
      {...guideForm}
      linkOutUrl="not a link"
      problems={['linkOutUrl', 'affiliateUrl']}
    />
  ),
};

export const LegalDocuments: Story = {
  render: () => <LegalDocsList rows={legalDocRows} />,
};

export const LegalDocumentsFailed: Story = {
  render: () => <LegalDocsList rows={[]} failed />,
};

export const LegalVersionList: Story = {
  render: () => (
    <LegalVersions doc="terms" rows={legalVersionRows} query={{}} />
  ),
};

export const LegalVersionsEmpty: Story = {
  render: () => <LegalVersions doc="privacy" rows={[]} query={{}} />,
};

export const LegalVersionsFailed: Story = {
  render: () => <LegalVersions doc="terms" rows={[]} query={{}} failed />,
};

const draftForm = {
  doc: 'terms',
  draftId: draftVersion.id,
  title: draftVersion.title,
  body: draftVersion.body,
  problems: [],
  save: noop,
} as const;

export const LegalDraftEditor: Story = {
  render: () => <LegalDraftForm {...draftForm} />,
};

export const LegalDraftStart: Story = {
  render: () => <LegalDraftForm {...draftForm} draftId={null} />,
};

export const LegalDraftWithProblems: Story = {
  render: () => <LegalDraftForm {...draftForm} problems={['title', 'body']} />,
};

export const Taxonomy: Story = {
  render: () => (
    <TaxonomyLists
      categories={categoryRows}
      neighborhoods={neighborhoodRows}
      act={noop}
    />
  ),
};

export const TaxonomyEmpty: Story = {
  render: () => <TaxonomyLists categories={[]} neighborhoods={[]} act={noop} />,
};

export const TaxonomyFailed: Story = {
  render: () => (
    <TaxonomyLists categories={[]} neighborhoods={[]} act={noop} failed />
  ),
};

export const TaxonomyAddForm: Story = {
  render: () => (
    <TaxonomyTermForm kind="category" term={null} problems={[]} save={noop} />
  ),
};

export const TaxonomyAddFormWithProblems: Story = {
  render: () => (
    <TaxonomyTermForm
      kind="neighborhood"
      term={null}
      problems={['name', 'slug']}
      save={noop}
    />
  ),
};

export const TaxonomyRenameForm: Story = {
  render: () => (
    <TaxonomyTermForm
      kind="category"
      term={{ id: bakingId, name: 'Baking' }}
      problems={['name']}
      save={noop}
    />
  ),
};
