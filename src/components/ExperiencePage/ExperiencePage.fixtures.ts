import { samplePhotos } from '@/components/Photo/Photo.fixtures';
import { galleryView, type ExperiencePageView } from '@/lib/experiencePage';

/** The experience of Figma frame 03: outdoor, with a weather call, a host, a meeting point, and fifteen photos. */
export const sunsetKayak: ExperiencePageView = {
  title: 'Sunset kayak on the Hudson',
  breadcrumb: [
    { label: 'Tribeca', href: '/new-york/neighborhoods/tribeca' },
    { label: 'Outdoors', href: '/new-york/things-to-do/outdoors' },
  ],
  badges: [{ tone: 'green', label: 'Outdoor', icon: 'outdoor' }],
  summary: 'Tribeca · 2\u00a0hr · Ages 14 and up',
  prices: [{ amount: '$65', unit: 'per person' }],
  keyFacts: [
    { icon: 'place', text: 'Tribeca' },
    { icon: 'duration', text: '2\u00a0hr' },
    { icon: 'age', text: 'Ages 14 and up' },
    { icon: 'weather', text: 'Weather call 3 hours before start' },
    { icon: 'cancellation', text: 'Free cancellation up to 24 hours before' },
  ],
  gallery: galleryView(samplePhotos(15)),
  about: [
    'Paddle out as the light goes gold. Guides start with a 20-minute lesson on the dock, then lead a slow loop past the piers while the skyline turns pink behind you. No experience needed, and everyone wears a life jacket.',
  ],
  included: [
    'Kayak, paddle, and life jacket',
    'A dry bag for your phone',
    'Lesson on the dock before you go',
    'Lockers at the boathouse',
  ],
  host: {
    name: 'Hudson Paddle Club',
    initial: 'H',
    description:
      'Six guides, all trained in water rescue. On Ramble since 2026.',
  },
  meeting: {
    text: 'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
    mapsHref:
      'https://www.google.com/maps/search/?api=1&query=Pier%2026%20boathouse%2C%20Tribeca%2C%20New%20York',
  },
  accessibility:
    "There's a ramp down to the dock. Getting into a kayak takes some mobility, and guides can help. Ask the host before you book.",
  weather:
    "Go or no-go is decided 3 hours before start. If it's off, you're refunded in full and emailed right away.",
  cancellation:
    'Free cancellation up to 24 hours before start. After that, no refund. If the host or the weather cancels, you get everything back.',
  giftHref: '/gifts/checkout/00000000-0000-4000-8000-000000000001',
  privateSessionHref: '/contact',
};

/** An indoor kids' class with two prices, one photo, and only what the host filled in. */
export const kidsClass: ExperiencePageView = {
  title: "Kids' wheel class",
  breadcrumb: [
    { label: 'Williamsburg', href: '/new-york/neighborhoods/williamsburg' },
    { label: 'Kids', href: '/new-york/things-to-do/kids' },
  ],
  badges: [{ tone: 'yellow', label: 'Kids' }],
  summary: 'Williamsburg · 1.5\u00a0hr · Ages 5 to 10',
  prices: [
    { amount: 'Free', unit: 'per adult' },
    { amount: '$45', unit: 'per child' },
  ],
  keyFacts: [
    { icon: 'place', text: 'Williamsburg' },
    { icon: 'duration', text: '1.5\u00a0hr' },
    { icon: 'age', text: 'Ages 5 to 10' },
    { icon: 'cancellation', text: 'Free cancellation up to 48 hours before' },
  ],
  gallery: galleryView(samplePhotos(1)),
  about: [
    'Kids sit at their own wheel and make a bowl they can use at breakfast.',
    'The teacher keeps the group to eight, so every child gets hands-on help.',
  ],
  included: [],
  host: { name: 'Wheelhouse Kids Studio', initial: 'W', description: null },
  meeting: {
    text: 'Wheelhouse Kids Studio, ground floor, Williamsburg.',
    mapsHref: null,
  },
  accessibility: 'Step-free entrance and a low sink for small hands.',
  weather: null,
  cancellation:
    'Free cancellation up to 2 days before start. After that, no refund. If the host or the weather cancels, you get everything back.',
  giftHref: null,
  privateSessionHref: '/contact',
};

/** The least a bookable experience can carry: no photo and no optional text. */
export const bareExperience: ExperiencePageView = {
  title: 'Evening walk',
  breadcrumb: [
    { label: 'Red Hook', href: '/new-york/neighborhoods/red-hook' },
    { label: 'Walks', href: '/new-york/things-to-do/walks' },
  ],
  badges: [],
  summary: 'Red Hook · All ages',
  prices: [{ amount: '$30', unit: 'per person' }],
  keyFacts: [
    { icon: 'place', text: 'Red Hook' },
    { icon: 'age', text: 'All ages' },
    { icon: 'cancellation', text: 'Free cancellation up to 24 hours before' },
  ],
  gallery: galleryView([]),
  about: [],
  included: [],
  host: { name: 'Red Hook Walks', initial: 'R', description: null },
  meeting: null,
  accessibility: null,
  weather: null,
  cancellation:
    'Free cancellation up to 24 hours before start. After that, no refund. If the host or the weather cancels, you get everything back.',
  giftHref: null,
  privateSessionHref: '/contact',
};
