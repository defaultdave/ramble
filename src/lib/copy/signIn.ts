// Text of the sign-in link shown on the page while email is not delivered to guests.

export const signInCopy = {
  onScreen: {
    title: 'Your sign-in link is ready',
    /** Names the address; the link is shown here and not emailed. */
    body: (email: string) =>
      `Email is off in this demo, so we show the link here instead of sending it to ${email}. It works once and lasts 5 minutes.`,
    continueLabel: 'Continue',
  },
} as const;
