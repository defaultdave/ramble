import type { LegalDocument } from '@/lib/legal';
import type { RichTextDoc } from '@/lib/richText/format';

const legalNotFoundTitle = 'Document not found';
export const legalFallbackTitle = 'Legal';

/**
 * Every legal text on Ramble is placeholder copy (PRD section 11), and each seeded document opens
 * by saying so. The label repeats it above the title so no one reads a skimmed page as counsel's.
 */
export const demoLabel = 'Demo text';

export type LegalView = {
  title: string;
  body: RichTextDoc;
  demoLabel: string;
};

export function buildLegalView(document: LegalDocument): LegalView {
  return { title: document.title, body: document.body, demoLabel };
}

/** The page's title: the document's own, or the not-found one when no published version exists. */
export function legalHead(document: LegalDocument | null): { title: string } {
  return { title: document ? document.title : legalNotFoundTitle };
}
