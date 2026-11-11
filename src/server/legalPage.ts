import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { LegalDocSchema, type LegalDocument } from '@/lib/legal';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { getCurrentLegalDocument } from '@/server/db/legal';

/**
 * The current published version of a document, or null when the key is malformed or nothing is
 * published under it. Publishing a version reaches it through `tags.legalDocument(doc)`. A miss is
 * not kept (the `uncached` profile), so made-up keys fill nothing.
 */
export async function getLegalPage(doc: string): Promise<LegalDocument | null> {
  'use cache';
  cacheLife('editorial');
  // safeParse, not parse: a ZodError carries the raw value, and Next.js logs what a cached function throws.
  if (!LegalDocSchema.safeParse(doc).success) {
    cacheLife('uncached');
    return null;
  }
  cacheTag(tags.legalDocument(doc));
  const document = await readOrRefuse('Legal document', () =>
    getCurrentLegalDocument(doc),
  );
  if (document === null) cacheLife('uncached');
  return document;
}
