/** The ids a form field's hint and error text take, and the aria-describedby that points at the ones shown. */
export function fieldIds(
  fieldId: string,
  {
    hint,
    errorText,
    describedBy,
  }: {
    hint?: string | undefined;
    errorText?: string | undefined;
    describedBy?: string | undefined;
  },
): { hintId: string; errorId: string; describedBy: string | undefined } {
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const ids = [hint ? hintId : '', errorText ? errorId : '', describedBy ?? '']
    .filter(Boolean)
    .join(' ');
  return { hintId, errorId, describedBy: ids || undefined };
}
