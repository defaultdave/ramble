// The review form and the states a review link can open to. The link comes from an email, so the
// copy never names a booking beyond the experience and the day the booker already knows.

export const reviewCopy = {
  eyebrow: 'From your review email · no account needed',
  heading: 'How was it?',
  form: {
    ratingLegend: 'Your rating',
    ratingOptions: [
      { value: 1, label: '1', description: 'Poor' },
      { value: 2, label: '2', description: 'Fair' },
      { value: 3, label: '3', description: 'Good' },
      { value: 4, label: '4', description: 'Very good' },
      { value: 5, label: '5', description: 'Excellent' },
    ],
    bodyLabel: 'Your review',
    bodyHint: (max: number) =>
      `What stood out? Up to ${String(max)} characters.`,
    note: 'You can leave one review for this booking, and it cannot be changed afterward.',
    submit: 'Post review',
    hostLine: (hostName: string, dayLabel: string) =>
      `With ${hostName} · ${dayLabel}`,
  },
  problems: {
    rating: 'Choose a rating from 1 to 5.',
    body: 'Write a few words about it.',
    summary: 'Some details need another look.',
  },
  states: {
    invalid: {
      title: "This review link doesn't work",
      body: 'The link may be old, mistyped, or for a session that has not finished yet. Open the link from your review email again.',
    },
    expired: {
      title: 'This review window has closed',
      body: 'Reviews are open for a limited time after a session. Thank you for coming along.',
    },
    alreadyReviewed: {
      title: 'You have already reviewed this booking',
      body: 'Only one review can be left for each booking.',
    },
    success: {
      title: 'Thank you for your review',
      body: 'Your review helps other guests choose what to do next.',
    },
    tooManyTries: {
      title: 'Too many tries',
      body: (seconds: number) =>
        `This link has been opened a lot in a short time. Try again in ${String(seconds)} seconds.`,
    },
  },
  links: {
    explore: 'Explore more experiences',
    help: 'Get help',
  },
} as const;
