import { z } from 'zod';
import type { CacheChange } from './cacheTags';
import { requiredText } from './text';
import { EntityIdSchema, WriteIdSchema } from './catalog';
import {
  editorialLimits,
  RichTextInputSchema,
  RichTextStoredSchema,
} from './editorial';

/**
 * A document key: a fixed one, or `waiver-` and a slug for a host's waiver. The database CHECK on
 * `legal_documents.doc` is this same rule, and a test holds the two to one pattern.
 */
export const legalDocPattern = String.raw`^(terms|privacy|host-agreement|waiver-[a-z0-9]+(-[a-z0-9]+)*)$`;

const legalDocRegex = new RegExp(legalDocPattern);

// The length is checked before the pattern, which repeats a group and recurses on long input.
export const LegalDocSchema = z
  .string()
  .refine(
    (value) =>
      value.length <= editorialLimits.slug && legalDocRegex.test(value),
    { message: 'A legal document key' },
  );

export type LegalKind =
  'marketplace_terms' | 'privacy_policy' | 'host_agreement' | 'waiver';

export function legalKindOf(doc: string): LegalKind | null {
  switch (doc) {
    case 'terms':
      return 'marketplace_terms';
    case 'privacy':
      return 'privacy_policy';
    case 'host-agreement':
      return 'host_agreement';
    default:
      return LegalDocSchema.safeParse(doc).success ? 'waiver' : null;
  }
}

const legalStatuses = ['draft', 'published'] as const;

const titleField = requiredText(editorialLimits.title);

export const LegalDocumentSchema = z.object({
  id: EntityIdSchema,
  doc: LegalDocSchema,
  version: z.int().positive(),
  title: titleField,
  body: RichTextStoredSchema,
  status: z.enum(legalStatuses),
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type LegalDocument = z.infer<typeof LegalDocumentSchema>;

/** A new version always starts as a draft; the version number is assigned when it is saved. */
export const LegalDraftInputSchema = z.strictObject({
  doc: LegalDocSchema,
  title: titleField,
  body: RichTextInputSchema,
});
export type LegalDraftInput = z.infer<typeof LegalDraftInputSchema>;

export const LegalDraftEditSchema = LegalDraftInputSchema.omit({ doc: true });
export type LegalDraftEdit = z.infer<typeof LegalDraftEditSchema>;

export const acceptanceSubjectKinds = ['order', 'host'] as const;

/** The most versions one checkout accepts: the marketplace terms, and the host's waiver where one is required. */
const maxOrderAcceptances = 2;

/** What a checkout records for its order: each published version the guest accepted, once. */
export const OrderAcceptancesInputSchema = z.strictObject({
  orderId: WriteIdSchema,
  legalDocumentIds: z.array(WriteIdSchema).min(1).max(maxOrderAcceptances),
});

export function legalChange(doc: string): CacheChange {
  return { kind: 'legalDocument', doc };
}

/** Only a draft can be edited or published. */
export function isDraft(status: (typeof legalStatuses)[number]): boolean {
  return status === 'draft';
}

/** The number of the next version of a document, given the highest version written so far, if any. */
export function nextLegalVersion(latestVersion: number | undefined): number {
  return (latestVersion ?? 0) + 1;
}

/** A draft cannot publish once a higher version of its document is published. */
export function isSuperseded(
  draftVersion: number,
  publishedVersions: readonly number[],
): boolean {
  return publishedVersions.some((version) => version > draftVersion);
}
