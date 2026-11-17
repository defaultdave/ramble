import type { HelpArticle } from '@/lib/editorial';
import { buildEntryRows } from '@/lib/editorialAdmin';
import { paragraphs } from '@/lib/richText/paragraphs';

export const publishedArticle: HelpArticle = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  slug: 'how-to-cancel',
  title: 'How to cancel',
  summary: 'Cancel up to the free-cancellation deadline.',
  position: 1,
  status: 'published',
  body: paragraphs(
    'Open your booking and choose Cancel.',
    'Refunds follow the deadline shown there.',
  ),
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  publishedAt: new Date('2026-11-02T15:00:00Z'),
};

export const draftArticle: HelpArticle = {
  ...publishedArticle,
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  slug: 'where-to-meet',
  title: 'Where to meet',
  summary: null,
  status: 'draft',
  publishedAt: null,
};

export const rows = buildEntryRows([publishedArticle, draftArticle]);
