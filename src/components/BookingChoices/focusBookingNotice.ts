/**
 * Moves focus to the refusal notice inside `scope` (a selector for the sheet or the panel). A refusal can
 * leave Continue disabled, so focus would fall to the page; the notice takes it and is read out.
 */
export function focusBookingNotice(scope: string) {
  document
    .querySelector<HTMLElement>(`${scope} [data-booking-notice]`)
    ?.focus();
}
