import type { BookingOffer, OfferedSession } from './bookingDraft';
import type { BookingBasics } from './pages/experience';

export const optionId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A session on its own calendar; the labels are what `sessionLabels` writes for a New York evening. */
export const session = (
  n: number,
  date: string,
  timeLabel: string,
  spacesLeft: number,
  dayLabel = dayOf(date),
): OfferedSession => ({
  id: optionId(100 + n),
  date,
  dayLabel,
  timeLabel,
  spacesLeft,
  cancelNote: `Free cancellation until ${dayOf(date)}, ${timeLabel}.`,
});

function dayOf(date: string): string {
  const days: Record<string, string> = {
    '2026-10-22': 'Thu, Oct 22',
    '2026-10-24': 'Sat, Oct 24',
    '2026-10-25': 'Sun, Oct 25',
    '2026-10-29': 'Thu, Oct 29',
  };
  return days[date] ?? date;
}

const common = {
  checkoutBase: '/checkout/',
  similarHref: '/new-york/things-to-do/outdoors',
  privateSessionHref: '/contact',
  maxSeats: 6,
  giftsEnabled: true,
  paused: false,
  today: '2026-10-18',
  preselectedDate: null,
} as const;

const sessions = [
  session(1, '2026-10-22', '5:30 PM EDT', 8),
  session(2, '2026-10-24', '4:00 PM EDT', 10),
  session(3, '2026-10-24', '5:30 PM EDT', 8),
  session(4, '2026-10-24', '7:00 PM EDT', 0),
  session(5, '2026-10-25', '5:30 PM EDT', 2),
  session(6, '2026-10-29', '5:30 PM EDT', 0),
];

/** Figma frame 04: one adult price, ages 14 and up, a few dates. */
export const kayakOffer: BookingOffer = {
  ...common,
  experienceId: optionId(1),
  title: 'Sunset kayak on the Hudson',
  options: [
    { id: optionId(11), kind: 'adult', priceMinor: 6500, usesSpace: true },
  ],
  childAges: null,
  ageNote: 'Ages 14 and up',
  twentyOnePlus: false,
  sessions,
};

/** Figma frame 04b: a free adult who takes no space, and children from 5 to 10 at $45. */
export const kidsOffer: BookingOffer = {
  ...common,
  experienceId: optionId(2),
  title: "Kids' wheel class",
  options: [
    { id: optionId(21), kind: 'adult', priceMinor: 0, usesSpace: false },
    { id: optionId(22), kind: 'child', priceMinor: 4500, usesSpace: true },
  ],
  childAges: { min: 5, max: 10 },
  ageNote: 'Ages 5 to 10',
  twentyOnePlus: false,
  sessions,
};

/** Figma frame 04c: 21 and over, $48 a head. */
export const twentyOneOffer: BookingOffer = {
  ...common,
  experienceId: optionId(3),
  title: 'Natural wine, explained',
  options: [
    { id: optionId(31), kind: 'adult', priceMinor: 4800, usesSpace: true },
  ],
  childAges: null,
  ageNote: '21 and over',
  twentyOnePlus: true,
  sessions,
};

/** A family price: an adult at $40 and a child at $25, both taking a space. */
export const familyOffer: BookingOffer = {
  ...common,
  experienceId: optionId(4),
  title: 'Harbor boat tour',
  options: [
    { id: optionId(41), kind: 'adult', priceMinor: 4000, usesSpace: true },
    { id: optionId(42), kind: 'child', priceMinor: 2500, usesSpace: true },
  ],
  childAges: { min: 0, max: 17 },
  ageNote: 'All ages',
  twentyOnePlus: false,
  sessions,
};

/** The offer without its dates, as the page view carries it. */
export function basicsOf(
  offer: BookingOffer,
  fullRefundHoursBefore = 24,
): BookingBasics {
  return {
    experienceId: offer.experienceId,
    title: offer.title,
    options: offer.options,
    childAges: offer.childAges,
    ageNote: offer.ageNote,
    twentyOnePlus: offer.twentyOnePlus,
    maxSeats: offer.maxSeats,
    giftsEnabled: offer.giftsEnabled,
    paused: offer.paused,
    checkoutBase: offer.checkoutBase,
    similarHref: offer.similarHref,
    privateSessionHref: offer.privateSessionHref,
    fullRefundHoursBefore,
  };
}
