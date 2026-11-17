// The ops guest-reviews page: hiding a review from guests and showing it again.

export const reviewModerationCopy = {
  nav: {
    label: 'Guest reviews',
    summary: 'Hide a guest review from the site, or show it again.',
  },
  title: 'Guest reviews',
  caption: 'Guest reviews',
  filterLabel: 'Filter reviews by status',
  columns: {
    written: 'Written',
    experience: 'Experience',
    rating: 'Rating',
    review: 'Review',
    from: 'From',
    status: 'Status',
    action: 'Action',
  },
  statusLabels: { visible: 'Visible', hidden: 'Hidden' },
  hideReasonLabel: (name: string, experience: string) =>
    `Reason for hiding the review by ${name}, ${experience}`,
  hideLabel: (name: string, experience: string) =>
    `Hide review by ${name}, ${experience}`,
  unhideLabel: (name: string, experience: string) =>
    `Show again the review by ${name}, ${experience}`,
  hideReasonPlaceholder: 'Choose a reason',
  hideReasons: {
    spam: 'Spam or an advertisement',
    abusive: 'Abusive or hateful',
    off_topic: 'Not about the experience',
    personal_info: 'Shares personal details',
    other: 'Another reason',
  },
  hide: 'Hide',
  unhide: 'Show again',
  empty: {
    title: 'No reviews',
    body: 'Reviews guests leave after a session appear here.',
  },
  notices: {
    hidden: 'Review hidden. Guests no longer see it.',
    unhidden: 'Review shown again.',
    already_hidden: 'That review was already hidden.',
    already_visible: 'That review is already visible.',
    not_found: 'That review could not be found.',
    invalid: 'Choose a reason to hide a review.',
  },
} as const;
