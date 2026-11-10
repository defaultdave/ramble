type AriaInvalid = boolean | 'true' | 'false' | 'grammar' | 'spelling';

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

/**
 * What a form control needs from its props: the caller's id or the generated one, the
 * aria-describedby, and aria-invalid, which an error text forces on and otherwise is the caller's.
 */
export function fieldControl({
  id,
  generatedId,
  hint,
  errorText,
  describedBy,
  ariaInvalid,
}: {
  id?: string | undefined;
  generatedId: string;
  hint?: string | undefined;
  errorText?: string | undefined;
  describedBy?: string | undefined;
  ariaInvalid?: AriaInvalid | undefined;
}): {
  fieldId: string;
  describedBy: string | undefined;
  ariaInvalid: AriaInvalid | undefined;
} {
  const fieldId = id ?? generatedId;
  return {
    fieldId,
    describedBy: fieldIds(fieldId, { hint, errorText, describedBy })
      .describedBy,
    ariaInvalid: errorText ? true : ariaInvalid,
  };
}
