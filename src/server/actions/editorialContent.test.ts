import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  idOrLeave: vi.fn(),
  savePageCopy: vi.fn(),
  readExperienceForOps: vi.fn(),
  updateExperience: vi.fn(),
  startLegalDraft: vi.fn(),
  saveLegalDraft: vi.fn(),
  publishLegalDraft: vi.fn(),
  addTaxonomyTerm: vi.fn(),
  renameTaxonomyTerm: vi.fn(),
  clickTaxonomyTerm: vi.fn(),
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
  savePageCopy: mocks.savePageCopy,
}));
vi.mock('@/server/db/experienceEditor', () => ({
  readExperienceForOps: mocks.readExperienceForOps,
  updateExperience: mocks.updateExperience,
}));
vi.mock('@/server/db/legalAdmin', () => ({
  startLegalDraft: mocks.startLegalDraft,
  saveLegalDraft: mocks.saveLegalDraft,
  publishLegalDraft: mocks.publishLegalDraft,
}));
vi.mock('@/server/db/taxonomy', () => ({
  addTaxonomyTerm: mocks.addTaxonomyTerm,
  renameTaxonomyTerm: mocks.renameTaxonomyTerm,
  clickTaxonomyTerm: mocks.clickTaxonomyTerm,
}));

import { newExperienceValues } from '@/lib/experienceEditor';
import {
  addTaxonomyAction,
  renameTaxonomyAction,
  saveGuideLinksAction,
  saveLegalDraftAction,
  savePageCopyAction,
  startLegalDraftAction,
  taxonomyClickAction,
} from './editorialContent';

// Behaviours under test:
// - every action checks the caller first: a caller sent away reads and saves nothing
// - page copy: an unreadable form goes to the list, a refused form returns to its page with the fields and saves nothing, a save passes the button's intent and returns with what it did
// - guide links: a refused form, a gone entry and an entry no longer guide-only save nothing; a save replaces only the two links in the stored content and reports what the save answered
// - legal: a bad document key leaves for the documents; a started draft shows on the versions; the save button never publishes; the publish button publishes after a save that came through only; a final version is not published
// - taxonomy: an unreadable form or click is stale; a refused form returns to its own form; a refusal of the form's field returns to it, and everything else shows on the lists

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function destination(call: Promise<void>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Redirected) return error.href;
    throw error;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
  mocks.idOrLeave.mockImplementation((data: FormData, field: string) =>
    data.get(field),
  );
});

describe('the caller is checked first', () => {
  it.each([
    ['savePageCopyAction', savePageCopyAction],
    ['saveGuideLinksAction', saveGuideLinksAction],
    ['startLegalDraftAction', startLegalDraftAction],
    ['saveLegalDraftAction', saveLegalDraftAction],
    ['addTaxonomyAction', addTaxonomyAction],
    ['renameTaxonomyAction', renameTaxonomyAction],
    ['taxonomyClickAction', taxonomyClickAction],
  ])('%s leaves before reading anything', async (_name, action) => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/editorial'));

    await expect(action(form({}))).rejects.toMatchObject({
      href: '/ops/editorial',
    });

    for (const mock of [
      mocks.savePageCopy,
      mocks.readExperienceForOps,
      mocks.updateExperience,
      mocks.startLegalDraft,
      mocks.saveLegalDraft,
      mocks.publishLegalDraft,
      mocks.addTaxonomyTerm,
      mocks.renameTaxonomyTerm,
      mocks.clickTaxonomyTerm,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe('savePageCopyAction', () => {
  const fields = {
    kind: 'category',
    targetId: id,
    intent: 'publish',
    status: 'draft',
  };

  it('saves with the intent and returns to the page with what it did', async () => {
    mocks.savePageCopy.mockResolvedValue({
      status: 'saved',
      value: { kind: 'category' },
    });

    const href = await destination(
      savePageCopyAction(form({ ...fields, heading: 'Hiking' })),
    );

    expect(href).toBe(`/ops/editorial/pages/category/${id}?notice=published`);
    expect(mocks.savePageCopy).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({
        kind: 'category',
        targetId: id,
        status: 'published',
        heading: 'Hiking',
      }),
      'publish',
    );
  });

  it('goes to the list for a form that names no page, and for a target that is gone', async () => {
    expect(await destination(savePageCopyAction(form({})))).toBe(
      '/ops/editorial/pages?notice=not_found',
    );
    mocks.savePageCopy.mockResolvedValue({ status: 'unknown_target' });
    expect(await destination(savePageCopyAction(form(fields)))).toBe(
      '/ops/editorial/pages?notice=not_found',
    );
  });

  it('returns a refused form to its page with the fields and saves nothing', async () => {
    const href = await destination(
      savePageCopyAction(form({ ...fields, body: '"words"' })),
    );

    expect(href).toBe(
      `/ops/editorial/pages/category/${id}?notice=invalid&fields=body`,
    );
    expect(mocks.savePageCopy).not.toHaveBeenCalled();
  });
});

describe('saveGuideLinksAction', () => {
  const links = {
    id,
    linkOutUrl: 'https://host.example.com/classes',
    affiliateUrl: 'https://host.example.com/classes?ref=ramble',
  };
  const content = newExperienceValues({
    categoryId: id,
    neighborhoodId: id,
    cancellationTierId: id,
  });

  it('replaces only the two links in the stored content and reports the save', async () => {
    mocks.readExperienceForOps.mockResolvedValue({
      status: 'guide_only',
      content,
    });
    mocks.updateExperience.mockResolvedValue({ status: 'updated' });

    const href = await destination(saveGuideLinksAction(form(links)));

    expect(href).toBe(`/ops/editorial/guides/${id}?notice=updated`);
    expect(mocks.updateExperience).toHaveBeenCalledWith(ops, id, {
      ...content,
      linkOutUrl: links.linkOutUrl,
      affiliateUrl: links.affiliateUrl,
    });
  });

  it('names only this form’s fields when the save refuses others', async () => {
    mocks.readExperienceForOps.mockResolvedValue({
      status: 'guide_only',
      content,
    });
    mocks.updateExperience.mockResolvedValue({
      status: 'invalid',
      fields: ['description', 'linkOutUrl'],
    });

    expect(await destination(saveGuideLinksAction(form(links)))).toBe(
      `/ops/editorial/guides/${id}?notice=invalid&fields=linkOutUrl`,
    );
  });

  it.each([
    [
      'a refused form',
      { id, linkOutUrl: 'nope' },
      null,
      `/ops/editorial/guides/${id}?notice=invalid&fields=linkOutUrl`,
    ],
    [
      'an entry that is gone',
      links,
      null,
      '/ops/editorial/guides?notice=not_found',
    ],
    [
      'an entry that went live',
      links,
      { status: 'live', content },
      '/ops/editorial/guides?notice=not_a_guide',
    ],
  ])('saves nothing for %s', async (_label, fields, view, href) => {
    mocks.readExperienceForOps.mockResolvedValue(view);

    expect(await destination(saveGuideLinksAction(form(fields)))).toBe(href);
    expect(mocks.updateExperience).not.toHaveBeenCalled();
  });
});

describe('the legal actions', () => {
  const fields = { doc: 'terms', title: 'Terms', body };

  it('leaves for the documents when the key is not one', async () => {
    expect(
      await destination(
        startLegalDraftAction(form({ ...fields, doc: 'Terms' })),
      ),
    ).toBe('/ops/editorial/legal');
    expect(
      await destination(
        saveLegalDraftAction(
          form({ ...fields, doc: 'x y', id, intent: 'save' }),
        ),
      ),
    ).toBe('/ops/editorial/legal');
    expect(mocks.startLegalDraft).not.toHaveBeenCalled();
  });

  it('starts a draft and shows it on the versions', async () => {
    mocks.startLegalDraft.mockResolvedValue({ id });

    const href = await destination(
      startLegalDraftAction(form({ ...fields, intent: 'save' })),
    );

    expect(href).toBe('/ops/editorial/legal/terms?notice=drafted');
    expect(mocks.startLegalDraft).toHaveBeenCalledWith(
      ops,
      expect.objectContaining({ doc: 'terms', title: 'Terms' }),
    );
  });

  it('returns a refused new draft to the versions with the field', async () => {
    expect(
      await destination(
        startLegalDraftAction(form({ ...fields, title: '', intent: 'save' })),
      ),
    ).toBe('/ops/editorial/legal/terms?notice=invalid&fields=title');
    expect(mocks.startLegalDraft).not.toHaveBeenCalled();
  });

  it('saves a draft without publishing on the save button', async () => {
    mocks.saveLegalDraft.mockResolvedValue({ status: 'saved', value: {} });

    expect(
      await destination(
        saveLegalDraftAction(form({ ...fields, id, intent: 'save' })),
      ),
    ).toBe(`/ops/editorial/legal/terms/${id}?notice=saved`);
    expect(mocks.publishLegalDraft).not.toHaveBeenCalled();
  });

  it('publishes after a save that came through, on the publish button', async () => {
    mocks.saveLegalDraft.mockResolvedValue({ status: 'saved', value: {} });
    mocks.publishLegalDraft.mockResolvedValue({
      status: 'published',
      value: {},
    });

    expect(
      await destination(
        saveLegalDraftAction(form({ ...fields, id, intent: 'publish' })),
      ),
    ).toBe('/ops/editorial/legal/terms?notice=published');
    expect(mocks.publishLegalDraft).toHaveBeenCalledWith(ops, id);
  });

  it('does not publish a version that is final, and reports a draft below a published one', async () => {
    mocks.saveLegalDraft.mockResolvedValue({ status: 'not_a_draft' });
    expect(
      await destination(
        saveLegalDraftAction(form({ ...fields, id, intent: 'publish' })),
      ),
    ).toBe('/ops/editorial/legal/terms?notice=not_a_draft');
    expect(mocks.publishLegalDraft).not.toHaveBeenCalled();

    mocks.saveLegalDraft.mockResolvedValue({ status: 'saved', value: {} });
    mocks.publishLegalDraft.mockResolvedValue({ status: 'superseded' });
    expect(
      await destination(
        saveLegalDraftAction(form({ ...fields, id, intent: 'publish' })),
      ),
    ).toBe('/ops/editorial/legal/terms?notice=superseded');
  });

  it('refuses to publish a version with no text and saves nothing', async () => {
    expect(
      await destination(
        saveLegalDraftAction(
          form({
            ...fields,
            id,
            intent: 'publish',
            body: JSON.stringify({ type: 'doc', content: [] }),
          }),
        ),
      ),
    ).toBe(`/ops/editorial/legal/terms/${id}?notice=invalid&fields=body`);
    expect(mocks.saveLegalDraft).not.toHaveBeenCalled();
  });
});

describe('the taxonomy actions', () => {
  it('adds a term and shows it on the lists', async () => {
    mocks.addTaxonomyTerm.mockResolvedValue({ status: 'saved', done: 'added' });

    expect(
      await destination(
        addTaxonomyAction(form({ kind: 'category', name: 'Hiking' })),
      ),
    ).toBe('/ops/editorial/taxonomy?notice=added');
    expect(mocks.addTaxonomyTerm).toHaveBeenCalledWith(ops, {
      kind: 'category',
      name: 'Hiking',
      slug: 'hiking',
    });
  });

  it.each([
    [
      'slug_taken',
      '/ops/editorial/taxonomy/neighborhood/new?notice=slug_taken&fields=slug',
    ],
    [
      'name_taken',
      '/ops/editorial/taxonomy/neighborhood/new?notice=name_taken&fields=name',
    ],
    ['list_full', '/ops/editorial/taxonomy?notice=list_full'],
  ])('answers %s from the save', async (reason, href) => {
    mocks.addTaxonomyTerm.mockResolvedValue({ status: 'refused', reason });

    expect(
      await destination(
        addTaxonomyAction(form({ kind: 'neighborhood', name: 'Dumbo' })),
      ),
    ).toBe(href);
  });

  it('returns a refused add form to itself and saves nothing; a form with no kind is stale', async () => {
    expect(
      await destination(
        addTaxonomyAction(form({ kind: 'category', name: ' ' })),
      ),
    ).toBe(
      '/ops/editorial/taxonomy/category/new?notice=invalid&fields=name%2Cslug',
    );
    expect(await destination(addTaxonomyAction(form({ name: 'A' })))).toBe(
      '/ops/editorial/taxonomy?notice=stale',
    );
    expect(mocks.addTaxonomyTerm).not.toHaveBeenCalled();
  });

  it('renames and shows it on the lists', async () => {
    mocks.renameTaxonomyTerm.mockResolvedValue({
      status: 'saved',
      done: 'renamed',
    });

    expect(
      await destination(
        renameTaxonomyAction(form({ kind: 'category', id, name: 'New' })),
      ),
    ).toBe('/ops/editorial/taxonomy?notice=renamed');
  });

  it('returns a taken name to the rename form with the field', async () => {
    mocks.renameTaxonomyTerm.mockResolvedValue({
      status: 'refused',
      reason: 'name_taken',
    });

    expect(
      await destination(
        renameTaxonomyAction(form({ kind: 'category', id, name: 'New' })),
      ),
    ).toBe(
      `/ops/editorial/taxonomy/category/${id}?notice=name_taken&fields=name`,
    );
    expect(
      await destination(renameTaxonomyAction(form({ kind: 'category' }))),
    ).toBe('/ops/editorial/taxonomy?notice=stale');
  });

  it('applies a click and shows what it did; an unreadable click is stale', async () => {
    mocks.clickTaxonomyTerm.mockResolvedValue({
      status: 'refused',
      reason: 'last_active',
    });

    expect(
      await destination(
        taxonomyClickAction(form({ op: `retire:category:${id}` })),
      ),
    ).toBe('/ops/editorial/taxonomy?notice=last_active');
    expect(mocks.clickTaxonomyTerm).toHaveBeenCalledWith(ops, {
      action: 'retire',
      kind: 'category',
      id,
    });

    mocks.clickTaxonomyTerm.mockClear();
    expect(await destination(taxonomyClickAction(form({ op: 'nope' })))).toBe(
      '/ops/editorial/taxonomy?notice=stale',
    );
    expect(mocks.clickTaxonomyTerm).not.toHaveBeenCalled();
  });
});
