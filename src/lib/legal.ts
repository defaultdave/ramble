import { z } from 'zod';
import type { CacheChange } from './cacheTags';
import { EntityIdSchema } from './catalog';
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

export const LegalDocSchema = z
  .string()
  .max(editorialLimits.slug)
  .regex(new RegExp(legalDocPattern));

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

const titleField = z
  .string()
  .max(editorialLimits.title * 2)
  .refine(
    (value) =>
      /\S/.test(value) && Array.from(value).length <= editorialLimits.title,
    {
      message: 'A title is 1 to 120 characters',
    },
  );

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

/** One checkout or onboarding accepts a handful of documents: terms, privacy, a waiver, the agreement. */
export const maxAcceptancesPerSubmission = 5;

export const LegalAcceptancesInputSchema = z.strictObject({
  subjectKind: z.enum(acceptanceSubjectKinds),
  subjectId: EntityIdSchema,
  documentIds: z.array(EntityIdSchema).min(1).max(maxAcceptancesPerSubmission),
});
export type LegalAcceptancesInput = z.infer<typeof LegalAcceptancesInputSchema>;

export function legalChange(doc: string): CacheChange {
  return { kind: 'legalDocument', doc };
}
