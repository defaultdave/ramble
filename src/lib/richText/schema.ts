import { z } from 'zod';
import { sanitizeRichText } from './sanitize';

/**
 * For a Server Action or data-layer boundary: rejects a value that is not a document
 * root, and sanitizes one that is.
 */
export const richTextSchema = z
  .looseObject({ type: z.literal('doc') })
  .transform((value) => sanitizeRichText(value));
