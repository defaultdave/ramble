import type { z } from 'zod';

/** One broken rule that ties a row's fields together: the field it is reported on and what is wrong. */
export type RuleIssue = { path: string; message: string };

/** Reports each issue on its field, so a schema's `superRefine` is one call. */
export function addRuleIssues(
  issues: readonly RuleIssue[],
  ctx: z.RefinementCtx,
): void {
  for (const issue of issues) {
    ctx.addIssue({
      code: 'custom',
      path: [issue.path],
      message: issue.message,
    });
  }
}
