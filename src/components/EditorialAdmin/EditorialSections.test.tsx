import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CollectionForm } from './CollectionForm';
import { CollectionItems } from './CollectionItems';
import { CollectionsList } from './CollectionsList';
import { HomeModuleForm } from './HomeModuleForm';
import { HomeModulesList } from './HomeModulesList';
import {
  addOptions,
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

// Behaviours under test:
// - the home list shows each module in order with its state in words, and the buttons that apply to it
// - every button and link in a row names its module or experience after the visible text
// - the first module cannot move up and the last cannot move down, and the gift guide has no switch and no editor
// - an empty list says so, and a failed read offers a retry
// - the module form shows only the settings its kind reads, carries its place and kind, and shows a refused field's sentence
// - the collections list links each Pick to its editor with its count and status, says when empty, and offers a retry on a failed read
// - a new collection can only be saved as a draft, and carries no id
// - a draft collection offers save draft and publish, a published one save changes and unpublish, each carrying its id
// - the entries list shows each experience in order with its note and buttons that post the click
// - the add form lists only the experiences not yet listed, in its own form, and says when none is left

const noop = () => undefined;

/** The entry at a place, or a failure that names the place: a test never reads past the end. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`Nothing at ${String(index)}`);
  return found;
}

describe('HomeModulesList', () => {
  it('shows each module in order with its state and detail', () => {
    render(<HomeModulesList rows={homeRows} act={noop} />);
    const items = within(
      screen.getByRole('list', { name: 'Home page modules' }),
    ).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Hero and search'),
      expect.stringContaining('Ramble Picks'),
      expect.stringContaining('Gift guide'),
      expect.stringContaining('On this week'),
    ]);
    expect(within(at(items, 0)).getByText('On')).toBeVisible();
    expect(within(at(items, 3)).getByText('Off')).toBeVisible();
    expect(within(at(items, 1)).getByText(/Weekend workshops/)).toBeVisible();
  });

  it('posts the place and kind of the module each button belongs to', () => {
    render(<HomeModulesList rows={homeRows} act={noop} />);
    const items = screen.getAllByRole('listitem');
    const first = at(items, 0);
    const second = at(items, 1);
    expect(
      within(second).getByRole('button', { name: /^Move up/ }),
    ).toHaveValue('up:1:picks');
    expect(
      within(first).getByRole('button', { name: /^Turn off/ }),
    ).toHaveValue('disable:0:hero_search');
    expect(within(first).getByRole('link', { name: /^Edit/ })).toHaveAttribute(
      'href',
      '/ops/editorial/home/0',
    );
  });

  it('disables a move past either end', () => {
    render(<HomeModulesList rows={homeRows} act={noop} />);
    const items = screen.getAllByRole('listitem');
    expect(
      within(at(items, 0)).getByRole('button', { name: /^Move up/ }),
    ).toBeDisabled();
    expect(
      within(at(items, 3)).getByRole('button', { name: /^Move down/ }),
    ).toBeDisabled();
    expect(
      within(at(items, 3)).getByRole('button', { name: /^Turn on/ }),
    ).toBeEnabled();
  });

  it('gives the gift guide module no switch and no editor, and says where it is managed', () => {
    render(<HomeModulesList rows={homeRows} act={noop} />);
    const gift = at(screen.getAllByRole('listitem'), 2);
    expect(within(gift).queryByRole('button', { name: /Turn o/ })).toBeNull();
    expect(within(gift).queryByRole('link', { name: /^Edit/ })).toBeNull();
    expect(
      within(gift).getByText('Managed with the gift guide.'),
    ).toBeVisible();
  });

  it('says when there are no modules', () => {
    render(<HomeModulesList rows={[]} act={noop} />);
    expect(screen.getByText('No modules yet')).toBeVisible();
  });

  it('offers a retry when the read failed', () => {
    render(<HomeModulesList rows={[]} act={noop} failed />);
    expect(
      screen.getByText('The home page modules could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/ops/editorial/home',
    );
  });
});

describe('row context in button and link names', () => {
  it('names the module in every home list button and link, keeping the visible text first', () => {
    render(<HomeModulesList rows={homeRows} act={noop} />);
    const first = at(screen.getAllByRole('listitem'), 0);
    for (const name of [
      'Move down Hero and search',
      'Turn off Hero and search',
    ]) {
      expect(within(first).getByRole('button', { name })).toBeVisible();
    }
    expect(
      within(first).getByRole('link', { name: 'Edit Hero and search' }),
    ).toBeVisible();
    expect(
      within(at(screen.getAllByRole('listitem'), 3)).getByRole('button', {
        name: 'Turn on On this week',
      }),
    ).toBeVisible();
  });

  it('names the experience in every entry button', () => {
    render(
      <CollectionItems
        collectionId={pickId}
        rows={itemRows}
        options={addOptions}
        problems={[]}
        act={noop}
      />,
    );
    const first = at(screen.getAllByRole('listitem'), 0);
    for (const name of [
      'Move up Pottery night',
      'Move down Pottery night',
      'Remove Pottery night',
    ]) {
      expect(within(first).getByRole('button', { name })).toBeVisible();
    }
  });
});

describe('HomeModuleForm', () => {
  const props = { picks, problems: [], save: noop } as const;

  it('shows heading and text for the hero, carrying its place, kind and state', async () => {
    const { container } = render(
      <HomeModuleForm {...props} module={heroModule} position={0} />,
    );
    await screen.findByRole('textbox', { name: 'Text' });
    expect(screen.getByRole('textbox', { name: /Heading/ })).toHaveValue(
      'Find something to do',
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.querySelector('input[name="position"]')).toHaveValue('0');
    expect(container.querySelector('input[name="kind"]')).toHaveValue(
      'hero_search',
    );
    expect(
      screen.getByRole('checkbox', { name: /Show this module/ }),
    ).toBeChecked();
  });

  it('shows heading and the Pick list for a picks module, with the Pick chosen', () => {
    render(<HomeModuleForm {...props} module={picksModule} position={1} />);
    expect(screen.getByRole('combobox', { name: /Ramble Pick/ })).toHaveValue(
      pickId,
    );
    expect(
      screen.getByRole('option', { name: 'Rainy days (draft)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Text')).toBeNull();
  });

  it('shows only the heading for a module that reads nothing else, and an unticked state', () => {
    render(<HomeModuleForm {...props} module={weekModule} position={3} />);
    expect(screen.getByRole('textbox', { name: /Heading/ })).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      screen.getByRole('checkbox', { name: /Show this module/ }),
    ).not.toBeChecked();
  });

  it('shows the sentence for a refused field', () => {
    render(
      <HomeModuleForm
        {...props}
        module={picksModule}
        position={1}
        problems={['heading', 'collectionId']}
      />,
    );
    expect(
      screen.getByText('Keep the heading to 120 characters.'),
    ).toBeVisible();
    expect(
      screen.getByText('Choose a Ramble Pick from the list.'),
    ).toBeVisible();
  });
});

describe('CollectionsList', () => {
  it('links each Pick to its editor with its count and status', () => {
    render(<CollectionsList rows={collectionRows} query={{}} />);
    const row = screen.getByRole('row', { name: /Weekend workshops/ });
    expect(
      within(row).getByRole('link', { name: 'Weekend workshops' }),
    ).toHaveAttribute('href', `/ops/editorial/collections/${pickId}`);
    expect(within(row).getByText('weekend-workshops')).toBeVisible();
    expect(within(row).getByText('2')).toBeVisible();
    expect(within(row).getByText('Published')).toBeVisible();
    expect(
      within(screen.getByRole('row', { name: /Rainy days/ })).getByText(
        'Draft',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'New collection' }),
    ).toHaveAttribute('href', '/ops/editorial/collections/new');
  });

  it('says when there are no collections and still offers a new one', () => {
    render(<CollectionsList rows={[]} query={{}} />);
    expect(screen.getByText('No collections yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'New collection' })).toBeVisible();
  });

  it('offers a retry when the read failed', () => {
    render(<CollectionsList rows={[]} query={{}} failed />);
    expect(
      screen.getByText('The collections could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/ops/editorial/collections',
    );
  });
});

describe('CollectionForm', () => {
  it('offers only save draft for a new collection, with no id', async () => {
    const { container } = render(
      <CollectionForm collection={null} problems={[]} save={noop} />,
    );
    await screen.findByRole('textbox', { name: 'Introduction' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveValue(
      'save',
    );
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(container.querySelector('input[name="id"]')).toBeNull();
  });

  it('offers save draft and publish for a draft, carrying its id and address', async () => {
    const { container } = render(
      <CollectionForm collection={draftPick} problems={[]} save={noop} />,
    );
    await screen.findByRole('textbox', { name: 'Introduction' });
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveValue(
      'publish',
    );
    expect(container.querySelector('input[name="id"]')).toHaveValue(
      draftPick.id,
    );
    expect(container.querySelector('input[name="currentSlug"]')).toHaveValue(
      'rainy-days',
    );
  });

  it('offers save changes and unpublish for a published collection', async () => {
    render(<CollectionForm collection={livePick} problems={[]} save={noop} />);
    await screen.findByRole('textbox', { name: 'Introduction' });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Weekend workshops',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toHaveValue(
      'unpublish',
    );
  });

  it('shows the sentence for each refused field', async () => {
    render(
      <CollectionForm
        collection={livePick}
        problems={['title', 'slug', 'summary', 'intro']}
        save={noop}
      />,
    );
    await screen.findByRole('textbox', { name: 'Introduction' });
    expect(
      screen.getByText('Add a title of up to 120 characters.'),
    ).toBeVisible();
    expect(
      screen.getByText(/Use lower-case words joined by hyphens/),
    ).toBeVisible();
    expect(
      screen.getByText('Keep the summary to 300 characters.'),
    ).toBeVisible();
    expect(
      screen.getByText('Check the introduction and each link.'),
    ).toBeVisible();
  });
});

describe('CollectionItems', () => {
  const props = {
    collectionId: pickId,
    rows: itemRows,
    options: addOptions,
    problems: [],
    act: noop,
  } as const;

  it('shows each experience in order with its note', () => {
    render(<CollectionItems {...props} />);
    const items = within(
      screen.getByRole('list', { name: 'Experiences in this collection' }),
    ).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(at(items, 0)).toHaveTextContent(/^Pottery night/);
    expect(within(at(items, 0)).getByText('Good for beginners')).toBeVisible();
    expect(at(items, 1)).toHaveTextContent(/^Weaving for two/);
  });

  it('posts the place and experience of the entry each button belongs to, and disables a move past either end', () => {
    render(<CollectionItems {...props} />);
    const items = screen.getAllByRole('listitem');
    const first = at(items, 0);
    const second = at(items, 1);
    expect(
      within(first).getByRole('button', { name: /^Move up/ }),
    ).toBeDisabled();
    expect(
      within(first).getByRole('button', { name: /^Move down/ }),
    ).toHaveValue(at(itemRows, 0).downValue);
    expect(
      within(second).getByRole('button', { name: /^Move down/ }),
    ).toBeDisabled();
    expect(within(second).getByRole('button', { name: /^Remove/ })).toHaveValue(
      at(itemRows, 1).removeValue,
    );
  });

  it('offers only the experiences not yet listed, in a form of its own', () => {
    render(<CollectionItems {...props} />);
    const select = screen.getByRole('combobox', { name: /Experience/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose an experience', 'Glass blowing (Draft)']);
    const add = screen.getByRole('button', { name: 'Add experience' });
    expect(add).toHaveValue('add');
    expect(add.closest('form')).not.toBe(
      at(screen.getAllByRole('listitem'), 0).closest('form'),
    );
    expect(add.closest('form')).toContainElement(
      screen.getByRole('textbox', { name: /Note/ }),
    );
  });

  it('says when there are no entries yet', () => {
    render(<CollectionItems {...props} rows={[]} />);
    expect(
      screen.getByText('No experiences yet. Add one below.'),
    ).toBeVisible();
  });

  it('says when every experience is already listed, and offers no add form', () => {
    render(<CollectionItems {...props} options={[]} />);
    expect(
      screen.getByText(/every experience is already listed/),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add experience' })).toBeNull();
  });

  it('shows the sentence for a refused field', () => {
    render(<CollectionItems {...props} problems={['experienceId', 'note']} />);
    expect(
      screen.getByText('Choose an experience from the list.'),
    ).toBeVisible();
    expect(screen.getByText('Keep the note to 280 characters.')).toBeVisible();
  });
});
