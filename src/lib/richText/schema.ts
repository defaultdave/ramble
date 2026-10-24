import { z } from 'zod';
import { inspectRichText } from './sanitize';

// TODO(U-076a): first caller, in the editor's save action.
/**
 * The write boundary, for a Server Action or data-layer function. It refuses a document
 * that `sanitizeRichText` would have to repair, with an issue per problem that names where
 * it is, so an editor's save never changes silently. A document that passes is stored as
 * it was written, minus empty paragraphs and attributes outside the format.
 *
 * The render path does not use this: `RichText` repairs whatever it is given.
 */
export const richTextSchema = z.unknown().transform((value, ctx) => {
  const { doc, problems } = inspectRichText(value);
  for (const problem of problems) {
    ctx.issues.push({
      code: 'custom',
      message: problem.message,
      path: problem.path,
      input: value,
    });
  }
  return problems.length > 0 ? z.NEVER : doc;
});
