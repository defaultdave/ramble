// The test-site console's review-invite section. The rest of the console keeps its text where it
// is until the folder migrates.

export const opsDevCopy = {
  runJob: {
    /** The name a screen reader gives a row's run button: the visible words first, then which job. */
    buttonName: (kind: string, dueLabel: string) =>
      `Run ${kind}, due ${dueLabel}`,
  },
  invites: {
    heading: 'Review invites',
    intro:
      'Sends a booker the email that links to the review form, as if the session had just ended. Run the queue afterwards to deliver it.',
    empty:
      'No booking can be invited now: none has a finished session without a review.',
    bookingLabel: 'Booking',
    send: 'Send invite now',
  },
} as const;
