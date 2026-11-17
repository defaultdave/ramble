import type { Caller } from '@/server/auth/caller';
import { doc } from './editorialFixtures';

// The category, neighborhood and legal admin rows of the authorization matrix: every function is
// for ops or admin, no host role. The modules are passed as getters because the matrix loads them
// in its beforeAll, after the rows are built.

const staff = ['ops', 'admin'] as const;
const missingTerm = '00000000-0000-4000-8000-000000000404';

type Taxonomy = typeof import('@/server/db/taxonomy');
type LegalAdmin = typeof import('@/server/db/legalAdmin');

export function taxonomyRows(
  taxonomy: () => Taxonomy,
  legalAdmin: () => LegalAdmin,
  draftId: () => string,
) {
  return [
    {
      fn: 'listTaxonomyForEditing',
      invoke: (c) => taxonomy().listTaxonomyForEditing(c, 'category'),
      allows: { platform: staff },
    },
    {
      fn: 'addTaxonomyTerm',
      invoke: (c) =>
        taxonomy().addTaxonomyTerm(c, {
          kind: 'neighborhood',
          name: 'Matrix',
          slug: 'matrix',
        }),
      allows: { platform: staff },
    },
    {
      fn: 'renameTaxonomyTerm',
      invoke: (c) =>
        taxonomy().renameTaxonomyTerm(c, {
          kind: 'category',
          id: missingTerm,
          name: 'Matrix',
        }),
      allows: { platform: staff },
    },
    {
      fn: 'clickTaxonomyTerm',
      invoke: (c) =>
        taxonomy().clickTaxonomyTerm(c, {
          kind: 'category',
          action: 'up',
          id: missingTerm,
        }),
      allows: { platform: staff },
    },
    {
      fn: 'listLegalDocSummaries',
      invoke: (c) => legalAdmin().listLegalDocSummaries(c),
      allows: { platform: staff },
    },
    {
      fn: 'startLegalDraft',
      invoke: (c) =>
        legalAdmin().startLegalDraft(c, {
          doc: 'privacy',
          title: 'A matrix draft',
          body: doc(),
        }),
      allows: { platform: staff },
    },
    {
      fn: 'saveLegalDraft',
      invoke: (c) =>
        legalAdmin().saveLegalDraft(c, draftId(), {
          title: 'A matrix edit',
          body: doc(),
        }),
      allows: { platform: staff },
    },
    {
      fn: 'publishLegalDraft',
      invoke: (c) => legalAdmin().publishLegalDraft(c, draftId()),
      allows: { platform: staff },
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
