import { z } from 'zod';
import { HttpUrlSchema } from './catalog';
import { opsEditorialContentCopy } from './copy/opsEditorialContent';
import { editorialPath } from './editorialAdmin';
import {
  experienceLimits,
  type ExperienceContent,
  type ExperienceStatus,
  type ExperienceEditView,
  type ExperienceFormField,
} from './experienceEditor';
import {
  fieldsFromIssues,
  formText,
  noticeHref,
  oversizedFields,
  type FormGetter,
} from './opsForm';

// The ops guide entries (PRD-13, 50): experiences whose status is guide-only. Ops sets where each
// sends guests: a link-out address, and an affiliate address where there is one. Everything else
// about the experience is edited with the other experiences, and a save here goes through the same
// save, so it has the same rules, audit row and cache clearing.

export const guidesPath = `${editorialPath}/guides`;
export const guidePath = (id: string) => `${guidesPath}/${id}`;

/** Only a guide-only entry has links to set here. */
export function isGuideEntry(status: ExperienceStatus): boolean {
  return status === 'guide_only';
}

export const guideFormFields = [
  'linkOutUrl',
  'affiliateUrl',
] as const satisfies readonly ExperienceFormField[];
export type GuideFormField = (typeof guideFormFields)[number];

const UrlSchema = HttpUrlSchema.max(experienceLimits.url);

const GuideLinksSchema = z.strictObject({
  linkOutUrl: UrlSchema,
  affiliateUrl: UrlSchema.nullable(),
});
export type GuideLinks = z.infer<typeof GuideLinksSchema>;

export type GuideForm =
  { ok: true; value: GuideLinks } | { ok: false; fields: GuideFormField[] };

/** The posted links. An address too long to be read is refused unread, so no rule walks an unbounded string. */
export function parseGuideForm(get: FormGetter): GuideForm {
  const oversized = oversizedFields(get, guideFormFields, experienceLimits.url);
  if (oversized.length > 0) return { ok: false, fields: oversized };
  const parsed = GuideLinksSchema.safeParse({
    linkOutUrl: formText(get, 'linkOutUrl'),
    affiliateUrl: formText(get, 'affiliateUrl') ?? null,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        fields: fieldsFromIssues(parsed.error.issues, guideFormFields),
      };
}

export type SettledGuide =
  { status: 'ready'; content: ExperienceContent } | { status: 'not_a_guide' };

/** The experience's locked content with the two links replaced, or that it is not a guide entry. */
export function settleGuide(
  view: Pick<ExperienceEditView, 'status' | 'content'>,
  links: GuideLinks,
): SettledGuide {
  if (!isGuideEntry(view.status)) return { status: 'not_a_guide' };
  return { status: 'ready', content: { ...view.content, ...links } };
}

export const guideNoticeCodes = [
  'updated',
  'unchanged',
  'not_a_guide',
  'not_found',
  'reference_missing',
  'invalid',
] as const;
export const guideNotices = opsEditorialContentCopy.guides.notices;

/** The save's answer as far as the redirect needs it: the data layer's result fits this shape. */
export type GuideSaveResult =
  | {
      status:
        | 'updated'
        | 'unchanged'
        | 'not_found'
        | 'not_a_guide'
        | 'reference_missing';
    }
  | { status: 'invalid'; fields: readonly ExperienceFormField[] };

export type GuideOutcome =
  | {
      status:
        | 'updated'
        | 'unchanged'
        | 'not_found'
        | 'not_a_guide'
        | 'reference_missing';
    }
  | { status: 'invalid'; fields: readonly GuideFormField[] };

/** What a save answered, as an outcome: a refusal names only the fields this form has. */
export function guideOutcomeFor(result: GuideSaveResult): GuideOutcome {
  if (result.status !== 'invalid') return result;
  return {
    status: 'invalid',
    fields: guideFormFields.filter((field) => result.fields.includes(field)),
  };
}

/** Where an outcome sends the editor: the entry's form, or the list for an entry that is gone or no longer a guide. */
export function guideRedirect(id: string, outcome: GuideOutcome): string {
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(guidePath(id), 'invalid', outcome.fields);
    case 'not_found':
    case 'not_a_guide':
      return noticeHref(guidesPath, outcome.status);
    default:
      return noticeHref(guidePath(id), outcome.status);
  }
}
