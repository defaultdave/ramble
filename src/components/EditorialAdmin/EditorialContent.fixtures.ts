import type { PageCopy } from '@/lib/editorial';
import { buildLegalDocRows, buildLegalVersionRows } from '@/lib/editorialLegal';
import { buildPageRows } from '@/lib/editorialPages';
import { buildTaxonomyRows } from '@/lib/editorialTaxonomy';
import type { ExperienceListRow } from '@/lib/experienceEditor';
import type { LegalDocument } from '@/lib/legal';
import { paragraphs } from '@/lib/richText/paragraphs';
import type { TaxonomyTerm } from '@/lib/taxonomy';

export const hikingId = '0a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
export const bakingId = '1b1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const dumboId = '2c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

const term = (
  id: string,
  slug: string,
  name: string,
  position: number,
  retired = false,
): TaxonomyTerm => ({
  id,
  slug,
  name,
  position,
  retiredAt: retired ? new Date('2026-11-01T12:00:00Z') : null,
});

const categoryTerms = [
  term(hikingId, 'hiking', 'Hiking', 0),
  term(bakingId, 'baking', 'Baking', 1),
  term('3d1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b', 'sailing', 'Sailing', 2, true),
];
const neighborhoodTerms = [term(dumboId, 'dumbo', 'DUMBO', 0)];

export const categoryRows = buildTaxonomyRows('category', categoryTerms);
export const neighborhoodRows = buildTaxonomyRows(
  'neighborhood',
  neighborhoodTerms,
);

export const hikingCopy: PageCopy = {
  id: '4e1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  kind: 'category',
  slug: 'hiking',
  heading: 'Hikes near the city',
  metaDescription: 'Guided hikes within an hour of Brooklyn.',
  status: 'published',
  intro: paragraphs('Boots on, phone away.'),
  body: null,
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  publishedAt: new Date('2026-11-02T15:00:00Z'),
};

export const pageCategoryRows = buildPageRows('category', categoryTerms, [
  hikingCopy,
]);
export const pageNeighborhoodRows = buildPageRows(
  'neighborhood',
  neighborhoodTerms,
  [],
);

export const guideRows: ExperienceListRow[] = [
  {
    id: '5f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    name: 'Letterpress basics',
    status: 'guide_only',
    hostName: 'Quill and Ink Press',
    categoryName: 'Ceramics and crafts',
  },
  {
    id: '6a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    name: 'Saturday run club',
    status: 'guide_only',
    hostName: 'Fifth Avenue Run Club',
    categoryName: 'Outdoors',
  },
];

export const guideId = guideRows[0]?.id ?? '';

const legalVersion = (
  overrides: Partial<LegalDocument> & Pick<LegalDocument, 'id' | 'version'>,
): LegalDocument => ({
  doc: 'terms',
  title: 'Marketplace terms',
  body: paragraphs('The terms of using Ramble.'),
  status: 'published',
  publishedAt: new Date('2026-11-02T15:00:00Z'),
  createdAt: new Date('2026-11-01T15:00:00Z'),
  ...overrides,
});

export const draftVersion = legalVersion({
  id: '7b1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  version: 3,
  status: 'draft',
  publishedAt: null,
});
const publishedVersion = legalVersion({
  id: '8c1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  version: 2,
});

export const legalVersionRows = buildLegalVersionRows([
  draftVersion,
  publishedVersion,
  legalVersion({
    id: '9d1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    version: 1,
    publishedAt: new Date('2026-10-01T15:00:00Z'),
  }),
]);

export const legalDocRows = buildLegalDocRows([
  { doc: 'terms', versions: 3, latestVersion: 3, publishedVersion: 2 },
  { doc: 'waiver-kayak', versions: 1, latestVersion: 1, publishedVersion: 1 },
]);
