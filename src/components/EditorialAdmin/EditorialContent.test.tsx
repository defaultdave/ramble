import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuideLinksForm } from './GuideLinksForm';
import { GuidesList } from './GuidesList';
import { LegalDocsList } from './LegalDocsList';
import { LegalDraftForm } from './LegalDraftForm';
import { LegalVersions } from './LegalVersions';
import { PageCopyForm } from './PageCopyForm';
import { PageCopyList } from './PageCopyList';
import { TaxonomyLists } from './TaxonomyLists';
import { TaxonomyTermForm } from './TaxonomyTermForm';
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

// Behaviours under test:
// - the page copy list has a table per kind, each name linking to its copy with its status, or that it has none
// - the copy form carries the kind, the target and the stored status; a published page offers save changes and unpublish, a draft or none save draft and publish; a refused field shows its sentence
// - the guide list links each entry to its links form, says when empty, and offers a retry on a failed read
// - the links form requires the link-out address, takes the affiliate address as optional, and shows a refused address's sentence
// - the legal list names each document with what is live, and offers a retry on a failed read
// - the versions table links only a draft to its editor, says when empty, and offers a retry on a failed read
// - the draft form carries the document and the draft, offers save and publish with the final-version warning; the new draft form has one button and no id
// - the taxonomy lists show each term in order with its state in words; every button and link names its term; the first cannot move up, the last cannot move down
// - the last term that is not retired has a disabled retire button and says why; a retired term offers to be brought back
// - the term form asks for a name and an address when adding, and only a name when renaming

const noop = () => undefined;

describe('PageCopyList', () => {
  it('shows a table per kind, each name linking to its copy', () => {
    render(
      <PageCopyList
        categories={pageCategoryRows}
        neighborhoods={pageNeighborhoodRows}
        query={{}}
      />,
    );
    const categories = screen.getByRole('table', { name: 'Category pages' });
    expect(
      within(categories).getByRole('link', { name: 'Hiking' }),
    ).toHaveAttribute('href', `/ops/editorial/pages/category/${hikingId}`);
    expect(within(categories).getByText('Published')).toBeVisible();
    expect(within(categories).getAllByText('No copy yet')).toHaveLength(2);
    expect(within(categories).getByText(/Retired/)).toBeVisible();
    expect(
      screen.getByRole('table', { name: 'Neighborhood pages' }),
    ).toBeVisible();
  });

  it('says when empty and offers a retry when the read failed', () => {
    const { rerender } = render(
      <PageCopyList categories={[]} neighborhoods={[]} query={{}} />,
    );
    expect(screen.getAllByText('Nothing to write yet')).toHaveLength(2);

    rerender(
      <PageCopyList categories={[]} neighborhoods={[]} query={{}} failed />,
    );
    expect(screen.getAllByText('The pages could not be loaded.')).toHaveLength(
      2,
    );
  });
});

describe('PageCopyForm', () => {
  const props = {
    kind: 'category',
    targetId: hikingId,
    problems: [],
    save: noop,
  } as const;
  const value = (container: HTMLElement, name: string) =>
    (container.querySelector(`input[name="${name}"]`) as HTMLInputElement)
      .value;

  it('carries the kind, the target and the stored status', () => {
    const { container } = render(<PageCopyForm {...props} page={hikingCopy} />);
    expect(value(container, 'kind')).toBe('category');
    expect(value(container, 'targetId')).toBe(hikingId);
    expect(value(container, 'status')).toBe('published');
    expect(screen.getByLabelText(/Heading/)).toHaveValue('Hikes near the city');
  });

  it.each([
    ['a published page', hikingCopy, 'Save changes', 'Unpublish', 'unpublish'],
    [
      'a draft',
      { ...hikingCopy, status: 'draft' as const },
      'Save draft',
      'Publish',
      'publish',
    ],
    ['a page with no copy', null, 'Save draft', 'Publish', 'publish'],
  ])('offers the buttons of %s', (_label, page, save, toggle, intent) => {
    render(<PageCopyForm {...props} page={page} />);
    expect(screen.getByRole('button', { name: save })).toHaveAttribute(
      'value',
      'save',
    );
    expect(screen.getByRole('button', { name: toggle })).toHaveAttribute(
      'value',
      intent,
    );
  });

  it('shows a refused field’s sentence', () => {
    render(<PageCopyForm {...props} page={null} problems={['heading']} />);
    expect(
      screen.getByText(/Keep the heading to 120 characters/),
    ).toBeVisible();
  });
});

describe('GuidesList', () => {
  it('links each entry to its links form', () => {
    render(
      <GuidesList
        rows={guideRows}
        query={{}}
        cursor={null}
        nextCursor={null}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Letterpress basics' }),
    ).toHaveAttribute('href', `/ops/editorial/guides/${guideId}`);
  });

  it('says when empty and offers a retry when the read failed', () => {
    const { rerender } = render(
      <GuidesList rows={[]} query={{}} cursor={null} nextCursor={null} />,
    );
    expect(screen.getByText('No guide entries')).toBeVisible();
    rerender(
      <GuidesList
        rows={[]}
        query={{}}
        cursor={null}
        nextCursor={null}
        failed
      />,
    );
    expect(
      screen.getByText('The guide entries could not be loaded.'),
    ).toBeVisible();
  });
});

describe('GuideLinksForm', () => {
  const props = {
    experienceId: guideId,
    linkOutUrl: 'https://host.example.com/a',
    affiliateUrl: null,
    problems: [],
    save: noop,
  } as const;

  it('requires the link-out address and takes the affiliate address as optional', () => {
    const { container } = render(<GuideLinksForm {...props} />);
    expect(screen.getByLabelText(/Link-out address/)).toBeRequired();
    expect(screen.getByLabelText(/Affiliate address/)).not.toBeRequired();
    expect(
      (container.querySelector('input[name="id"]') as HTMLInputElement).value,
    ).toBe(guideId);
  });

  it('shows the sentence of each refused address', () => {
    render(
      <GuideLinksForm {...props} problems={['linkOutUrl', 'affiliateUrl']} />,
    );
    expect(
      screen.getAllByText(
        'Enter a web address starting with http:// or https://.',
      ),
    ).toHaveLength(2);
  });
});

describe('the legal admin', () => {
  it('lists each document with what is live and what is waiting', () => {
    render(<LegalDocsList rows={legalDocRows} />);
    const items = within(
      screen.getByRole('list', { name: 'Legal documents' }),
    ).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Marketplace terms');
    expect(items[0]).toHaveTextContent(
      'Version 2 is live. Draft version 3 is waiting.',
    );
    expect(
      screen.getByRole('link', { name: 'Waiver: waiver-kayak' }),
    ).toHaveAttribute('href', '/ops/editorial/legal/waiver-kayak');
  });

  it('offers a retry when the read failed', () => {
    render(<LegalDocsList rows={[]} failed />);
    expect(
      screen.getByText('The legal documents could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Try again' })).toBeVisible();
  });

  it('links only a draft to its editor', () => {
    render(<LegalVersions doc="terms" rows={legalVersionRows} query={{}} />);
    expect(screen.getAllByRole('link', { name: /Edit draft/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Edit draft 3' })).toHaveAttribute(
      'href',
      `/ops/editorial/legal/terms/${draftVersion.id}`,
    );
    expect(screen.getByText('Version 2')).toBeVisible();
  });

  it('says when empty and offers a retry when the read failed', () => {
    const { rerender } = render(
      <LegalVersions doc="terms" rows={[]} query={{}} />,
    );
    expect(screen.getByText('No versions yet')).toBeVisible();
    rerender(<LegalVersions doc="terms" rows={[]} query={{}} failed />);
    expect(
      screen.getByText('The legal documents could not be loaded.'),
    ).toBeVisible();
  });

  const draft = {
    doc: 'terms',
    title: 'Terms',
    body: draftVersion.body,
    problems: [],
    save: noop,
  } as const;

  it('carries the document and the draft, with save, publish and the final-version warning', () => {
    const { container } = render(
      <LegalDraftForm {...draft} draftId={draftVersion.id} />,
    );
    expect(
      (container.querySelector('input[name="doc"]') as HTMLInputElement).value,
    ).toBe('terms');
    expect(
      (container.querySelector('input[name="id"]') as HTMLInputElement).value,
    ).toBe(draftVersion.id);
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveAttribute(
      'value',
      'save',
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveAttribute(
      'value',
      'publish',
    );
    expect(
      screen.getByText(/a published version cannot be edited/),
    ).toBeVisible();
  });

  it('starts a draft with one button and no id', () => {
    const { container } = render(<LegalDraftForm {...draft} draftId={null} />);
    expect(container.querySelector('input[name="id"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start draft' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('shows the sentence of each refused field', () => {
    render(
      <LegalDraftForm {...draft} draftId={null} problems={['title', 'body']} />,
    );
    expect(
      screen.getByText(/Add a title of up to 120 characters/),
    ).toBeVisible();
    expect(screen.getByText('Check the text and each link.')).toBeVisible();
  });
});

describe('TaxonomyLists', () => {
  const lists = (
    <TaxonomyLists
      categories={categoryRows}
      neighborhoods={neighborhoodRows}
      act={noop}
    />
  );

  it('shows each term in order with its state in words', () => {
    render(lists);
    const items = within(
      screen.getByRole('list', { name: 'Categories in order' }),
    ).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Hiking'),
      expect.stringContaining('Baking'),
      expect.stringContaining('Sailing'),
    ]);
    expect(within(items[0] as HTMLElement).getByText('In use')).toBeVisible();
    expect(within(items[2] as HTMLElement).getByText('Retired')).toBeVisible();
  });

  it('names its term in every button and link of a row', () => {
    render(lists);
    for (const name of [
      'Move up Baking',
      'Move down Baking',
      'Retire Baking',
      'Rename Baking',
      'Bring back Sailing',
    ]) {
      expect(
        screen.getByRole(name.startsWith('Rename') ? 'link' : 'button', {
          name,
        }),
      ).toBeVisible();
    }
    expect(screen.getByRole('link', { name: 'Rename Baking' })).toHaveAttribute(
      'href',
      `/ops/editorial/taxonomy/category/${bakingId}`,
    );
  });

  it('cannot move the first up or the last down', () => {
    render(lists);
    expect(
      screen.getByRole('button', { name: 'Move up Hiking' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move down Sailing' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move down Hiking' }),
    ).toBeEnabled();
  });

  it('blocks retiring the last term in use and says why', () => {
    render(lists);
    expect(screen.getByRole('button', { name: 'Retire DUMBO' })).toBeDisabled();
    expect(
      screen.getByText('The last one that is not retired cannot be retired.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retire Hiking' })).toBeEnabled();
  });

  it('links each kind to its add form', () => {
    render(lists);
    expect(
      screen.getByRole('link', { name: 'Add a category' }),
    ).toHaveAttribute('href', '/ops/editorial/taxonomy/category/new');
    expect(
      screen.getByRole('link', { name: 'Add a neighborhood' }),
    ).toBeVisible();
  });

  it('says when a list is empty and offers a retry when the read failed', () => {
    const { rerender } = render(
      <TaxonomyLists categories={[]} neighborhoods={[]} act={noop} />,
    );
    expect(screen.getAllByText('None yet')).toHaveLength(2);
    rerender(
      <TaxonomyLists categories={[]} neighborhoods={[]} act={noop} failed />,
    );
    expect(screen.getByText('The lists could not be loaded.')).toBeVisible();
  });
});

describe('TaxonomyTermForm', () => {
  it('asks for a name and an address when adding', () => {
    const { container } = render(
      <TaxonomyTermForm
        kind="neighborhood"
        term={null}
        problems={[]}
        save={noop}
      />,
    );
    expect(screen.getByLabelText(/^Name/)).toBeRequired();
    expect(screen.getByLabelText(/^Address/)).not.toBeRequired();
    expect(container.querySelector('input[name="id"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeVisible();
  });

  it('asks only for a name when renaming, carrying the id, and says the address stays', () => {
    const { container } = render(
      <TaxonomyTermForm
        kind="category"
        term={{ id: bakingId, name: 'Baking' }}
        problems={['name']}
        save={noop}
      />,
    );
    expect(screen.getByLabelText(/New name/)).toHaveValue('Baking');
    expect(screen.queryByLabelText(/^Address/)).toBeNull();
    expect(
      (container.querySelector('input[name="id"]') as HTMLInputElement).value,
    ).toBe(bakingId);
    expect(screen.getByText('The address stays as it is.')).toBeVisible();
    expect(
      screen.getByText(/Enter a name of up to 80 characters/),
    ).toBeVisible();
  });
});
