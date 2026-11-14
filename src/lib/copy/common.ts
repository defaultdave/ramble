// Text every area shares: the brand, the error and not-found notices, and the site's header and
// footer labels. Links and their addresses stay with the modules that route them.

const brand = 'Ramble';

const nav = {
  thingsToDo: 'Things to do',
  ramblePicks: 'Ramble Picks',
  giftGuide: 'Gift guide',
} as const;

export const commonCopy = {
  brand,
  actions: {
    tryAgain: 'Try again',
  },
  error: {
    title: 'Something went wrong on our side',
    body: 'This page did not load. Try again in a moment.',
  },
  notFound: {
    title: "We can't find that page",
    body: 'The link may be old or mistyped.',
    homeLink: `Go to the ${brand} home page`,
  },
  nav: {
    ...nav,
    /** What the header's search pill says; `party` is the guest count it links with. */
    searchLabel: (party: string) => `Anywhere · Any day · ${party}`,
  },
  footer: {
    tagline: 'The friend who always knows what to do in New York.',
    copyright: `© 2026 ${brand}. Made in Brooklyn.`,
    groups: {
      explore: 'Explore',
      help: 'Help',
      brand,
    },
    links: {
      ...nav,
      helpCenter: 'Help center',
      contact: 'Contact us',
      accessibility: 'Accessibility',
      terms: 'Terms',
      privacy: 'Privacy',
    },
  },
} as const;
