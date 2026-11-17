import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  idOrLeave: vi.fn(),
  saveHelpArticle: vi.fn(),
  saveHomeModules: vi.fn(),
  listHomeModulesForEditing: vi.fn(),
  saveCollection: vi.fn(),
  listCollectionsForEditing: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/opsAccess', () => ({
  opsCallerOrLeave: mocks.opsCallerOrLeave,
  idOrLeave: mocks.idOrLeave,
}));
vi.mock('@/server/db/editorial', () => ({
  saveHelpArticle: mocks.saveHelpArticle,
  saveHomeModules: mocks.saveHomeModules,
  listHomeModulesForEditing: mocks.listHomeModulesForEditing,
  saveCollection: mocks.saveCollection,
  listCollectionsForEditing: mocks.listCollectionsForEditing,
}));

import {
  collectionItemsAction,
  homeModuleOpAction,
  saveCollectionAction,
  saveEntryAction,
  saveHomeModuleAction,
} from './editorial';

// Behaviours under test:
// - the caller is checked first: a caller sent away saves nothing
// - a refused form returns to the form it came from, with the fields to look at, and saves nothing
// - a new entry is saved as a draft, an existing one keeps its id, and publish and unpublish move the status
// - each outcome redirects: the edit page with what the click did, the form on a taken address, the list for a missing entry
// - every action checks the caller first, and a caller sent away reads and saves nothing
// - a home module click reads the stored list, saves the changed list, and redirects with what it did; a stale or gift guide click saves nothing
// - a home module edit saves the edited list, and returns to the form on a refusal
// - a collection save settles against the stored Pick, publishes only with entries, and sends a new Pick to its own page
// - removing the last entry of a published Pick, and a form that names a Pick by a bad id, save nothing
// - a click on a collection's list saves the stored Pick with its entries changed, and a stale or unreadable click saves nothing

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const fields = { intent: 'save', title: 'How to cancel', body };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
  mocks.saveHelpArticle.mockResolvedValue({ status: 'saved', value: { id } });
});

describe('saveEntryAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/editorial'));
    await expect(saveEntryAction(form(fields))).rejects.toMatchObject({
      href: '/ops/editorial',
    });
    expect(mocks.saveHelpArticle).not.toHaveBeenCalled();
  });

  it.each([
    ['a new entry', {}, '/ops/editorial/new'],
    ['an existing one', { id }, `/ops/editorial/${id}`],
  ])(
    'returns %s to its form when the title is blank',
    async (_n, extra, href) => {
      await expect(
        saveEntryAction(form({ ...fields, ...extra, title: '', slug: 'a' })),
      ).rejects.toMatchObject({ href: `${href}?notice=invalid&fields=title` });
      expect(mocks.saveHelpArticle).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['save', 'draft', 'draft', 'saved'],
    ['publish', 'draft', 'published', 'published'],
    ['unpublish', 'published', 'draft', 'unpublished'],
  ])(
    '%s on a %s entry writes %s and shows the %s notice',
    async (intent, current, status, notice) => {
      await expect(
        saveEntryAction(form({ ...fields, id, intent, status: current })),
      ).rejects.toMatchObject({
        href: `/ops/editorial/${id}?notice=${notice}`,
      });
      expect(mocks.saveHelpArticle).toHaveBeenCalledWith(
        ops,
        expect.objectContaining({ id, status, slug: 'how-to-cancel' }),
        intent,
      );
    },
  );

  it('sends a taken address back to the form with the slug marked', async () => {
    mocks.saveHelpArticle.mockResolvedValue({ status: 'slug_taken' });
    await expect(saveEntryAction(form(fields))).rejects.toMatchObject({
      href: '/ops/editorial/new?notice=slug_taken&fields=slug',
    });
  });

  it('sends a missing entry to the list with its notice', async () => {
    mocks.saveHelpArticle.mockResolvedValue({ status: 'not_found' });
    await expect(
      saveEntryAction(form({ ...fields, id })),
    ).rejects.toMatchObject({ href: '/ops/editorial?notice=not_found' });
  });

  it('sends a body left empty on a published entry back to the form', async () => {
    mocks.saveHelpArticle.mockResolvedValue({ status: 'empty_body' });
    await expect(
      saveEntryAction(form({ ...fields, id })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/${id}?notice=invalid&fields=body`,
    });
  });
});

const modules = [
  {
    id: 'a',
    position: 0,
    kind: 'hero_search',
    enabled: true,
    heading: null,
    collectionId: null,
    body: null,
  },
  {
    id: 'b',
    position: 1,
    kind: 'this_week',
    enabled: true,
    heading: null,
    collectionId: null,
    body: null,
  },
];

describe('homeModuleOpAction', () => {
  beforeEach(() => {
    mocks.listHomeModulesForEditing.mockResolvedValue(modules);
    mocks.saveHomeModules.mockResolvedValue({ status: 'saved' });
  });

  it('leaves before reading when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(
      new Redirected('/ops/editorial/home'),
    );
    await expect(
      homeModuleOpAction(form({ op: 'down:0:hero_search' })),
    ).rejects.toMatchObject({ href: '/ops/editorial/home' });
    expect(mocks.listHomeModulesForEditing).not.toHaveBeenCalled();
    expect(mocks.saveHomeModules).not.toHaveBeenCalled();
  });

  it('saves the list with the module moved and shows the moved notice', async () => {
    await expect(
      homeModuleOpAction(form({ op: 'down:0:hero_search' })),
    ).rejects.toMatchObject({ href: '/ops/editorial/home?notice=moved' });
    expect(mocks.saveHomeModules).toHaveBeenCalledWith(ops, [
      expect.objectContaining({ kind: 'this_week' }),
      expect.objectContaining({ kind: 'hero_search' }),
    ]);
  });

  it.each([
    ['a click that cannot be read', { op: 'nope' }],
    ['a click for a module that is no longer there', { op: 'down:0:picks' }],
  ])('saves nothing for %s', async (_name, fields) => {
    await expect(homeModuleOpAction(form(fields))).rejects.toMatchObject({
      href: '/ops/editorial/home?notice=stale',
    });
    expect(mocks.saveHomeModules).not.toHaveBeenCalled();
  });

  it('shows what a refused save answered', async () => {
    mocks.saveHomeModules.mockResolvedValue({ status: 'unknown_collection' });
    await expect(
      homeModuleOpAction(form({ op: 'disable:0:hero_search' })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/home?notice=unknown_collection',
    });
  });
});

describe('saveHomeModuleAction', () => {
  beforeEach(() => {
    mocks.listHomeModulesForEditing.mockResolvedValue(modules);
    mocks.saveHomeModules.mockResolvedValue({ status: 'saved' });
  });

  it('leaves before reading when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(
      new Redirected('/ops/editorial/home'),
    );
    await expect(
      saveHomeModuleAction(form({ position: '0', kind: 'hero_search' })),
    ).rejects.toMatchObject({ href: '/ops/editorial/home' });
    expect(mocks.saveHomeModules).not.toHaveBeenCalled();
  });

  it('saves the edited list and returns to the list with the saved notice', async () => {
    await expect(
      saveHomeModuleAction(
        form({
          position: '0',
          kind: 'hero_search',
          enabled: 'on',
          heading: 'Hello',
        }),
      ),
    ).rejects.toMatchObject({ href: '/ops/editorial/home?notice=saved' });
    expect(mocks.saveHomeModules).toHaveBeenCalledWith(ops, [
      expect.objectContaining({
        kind: 'hero_search',
        heading: 'Hello',
        enabled: true,
      }),
      expect.objectContaining({ kind: 'this_week' }),
    ]);
  });

  it('returns a refused form to its page with the field named, and saves nothing', async () => {
    await expect(
      saveHomeModuleAction(
        form({ position: '0', kind: 'hero_search', body: 'not json' }),
      ),
    ).rejects.toMatchObject({
      href: '/ops/editorial/home/0?notice=invalid&fields=body',
    });
    expect(mocks.saveHomeModules).not.toHaveBeenCalled();
  });

  it('sends a form that names no module to the list as stale', async () => {
    await expect(saveHomeModuleAction(form({}))).rejects.toMatchObject({
      href: '/ops/editorial/home?notice=stale',
    });
  });
});

const experience = '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const storedPick = {
  id,
  kind: 'pick',
  slug: 'weekend-workshops',
  title: 'Weekend workshops',
  summary: null,
  intro: null,
  status: 'draft',
  publishedAt: null,
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  items: [{ experienceId: experience, note: null }],
};

describe('saveCollectionAction', () => {
  beforeEach(() => {
    mocks.listCollectionsForEditing.mockResolvedValue([storedPick]);
    mocks.saveCollection.mockResolvedValue({ status: 'saved', value: { id } });
  });

  it('leaves before reading when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(
      new Redirected('/ops/editorial/collections'),
    );
    await expect(
      saveCollectionAction(form({ intent: 'save', title: 'A' })),
    ).rejects.toMatchObject({ href: '/ops/editorial/collections' });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('returns a blank title to the form with the fields named, and saves nothing', async () => {
    await expect(
      saveCollectionAction(form({ intent: 'save', title: '' })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections/new?notice=invalid&fields=title%2Cslug',
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('saves a new Pick as a draft with no entries and sends it to its own page', async () => {
    await expect(
      saveCollectionAction(
        form({ intent: 'save', title: 'Weekend workshops' }),
      ),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=saved`,
    });
    expect(mocks.listCollectionsForEditing).not.toHaveBeenCalled();
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({ kind: 'pick', status: 'draft', items: [] }),
    );
  });

  it('publishes a stored Pick with its stored entries and shows the published notice', async () => {
    await expect(
      saveCollectionAction(
        form({ intent: 'publish', title: 'Weekend workshops', id }),
      ),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=published`,
    });
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({
        id,
        status: 'published',
        items: storedPick.items,
      }),
    );
  });

  it('does not publish a Pick with no entries', async () => {
    mocks.listCollectionsForEditing.mockResolvedValue([
      { ...storedPick, items: [] },
    ]);
    await expect(
      saveCollectionAction(form({ intent: 'publish', title: 'A', id })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=no_entries`,
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('sends a form that names a Pick by something that is not an id to the list, saving nothing', async () => {
    await expect(
      saveCollectionAction(form({ intent: 'save', title: 'A', id: 'nope' })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections?notice=not_found',
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('sends a Pick that is gone to the list', async () => {
    mocks.listCollectionsForEditing.mockResolvedValue([]);
    await expect(
      saveCollectionAction(form({ intent: 'save', title: 'A', id })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections?notice=not_found',
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('sends a taken address back to the form', async () => {
    mocks.saveCollection.mockResolvedValue({ status: 'slug_taken' });
    await expect(
      saveCollectionAction(form({ intent: 'save', title: 'A' })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections/new?notice=slug_taken&fields=slug',
    });
  });
});

describe('collectionItemsAction', () => {
  beforeEach(() => {
    mocks.idOrLeave.mockReturnValue(id);
    mocks.listCollectionsForEditing.mockResolvedValue([storedPick]);
    mocks.saveCollection.mockResolvedValue({ status: 'saved', value: { id } });
  });

  it('leaves before reading when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(
      new Redirected('/ops/editorial/collections'),
    );
    await expect(
      collectionItemsAction(form({ id, op: 'add' })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections',
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('adds an experience and shows the added notice', async () => {
    const other = '2a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
    await expect(
      collectionItemsAction(
        form({ id, op: 'add', experienceId: other, note: 'Hi' }),
      ),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=entry_added`,
    });
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({
        items: [...storedPick.items, { experienceId: other, note: 'Hi' }],
      }),
    );
  });

  it('refuses to remove the last entry of a published Pick, saving nothing', async () => {
    mocks.listCollectionsForEditing.mockResolvedValue([
      { ...storedPick, status: 'published' },
    ]);
    await expect(
      collectionItemsAction(form({ id, op: `remove:0:${experience}` })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=no_entries`,
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('removes an entry', async () => {
    await expect(
      collectionItemsAction(form({ id, op: `remove:0:${experience}` })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=entry_removed`,
    });
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({ items: [] }),
    );
  });

  it.each([
    ['a click that cannot be read', { op: 'nope' }, 'entry_stale'],
    [
      'a click for an entry no longer there',
      { op: `remove:3:${experience}` },
      'entry_stale',
    ],
    [
      'an experience already listed',
      { op: 'add', experienceId: experience },
      'entry_listed',
    ],
  ])('saves nothing for %s', async (_name, fields, notice) => {
    await expect(
      collectionItemsAction(form({ id, ...fields })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=${notice}`,
    });
    expect(mocks.saveCollection).not.toHaveBeenCalled();
  });

  it('returns an add with no experience to the form with the field named', async () => {
    await expect(
      collectionItemsAction(form({ id, op: 'add' })),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=invalid&fields=experienceId`,
    });
  });

  it('sends a Pick that is gone to the list', async () => {
    mocks.listCollectionsForEditing.mockResolvedValue([]);
    await expect(
      collectionItemsAction(form({ id, op: `remove:0:${experience}` })),
    ).rejects.toMatchObject({
      href: '/ops/editorial/collections?notice=not_found',
    });
  });

  it('shows an unknown experience the save refused', async () => {
    mocks.saveCollection.mockResolvedValue({ status: 'unknown_experience' });
    await expect(
      collectionItemsAction(
        form({
          id,
          op: 'add',
          experienceId: '2a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
        }),
      ),
    ).rejects.toMatchObject({
      href: `/ops/editorial/collections/${id}?notice=unknown_experience`,
    });
  });
});
