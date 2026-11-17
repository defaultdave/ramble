import { reviewsView, type ReviewRow } from '@/lib/reviewList';

const bodies = [
  'Gold light on the water and a guide who never rushed us. Easy to book, easy to find.',
  'First time in a kayak. The lesson on the dock was short and clear, and I was never worried.',
  'We saw the skyline turn pink from the middle of the river. Worth every dollar.',
  'Great evening. The lockers were handy, and the dry bag kept my phone safe.',
  'A little choppy near the pier, but the guides kept everyone together.',
  'Booked for my birthday. Ten out of ten.',
  'Lovely small group, relaxed pace.',
  'Wore the wrong shoes and the staff lent me a pair. Kind people.',
  'Could have been longer, but a good time.',
  'Perfect after a long week.',
];
const names = [
  'Noor',
  'Tomas',
  'Imani',
  'Callum',
  'Priya',
  'Hana',
  'Felix',
  'Lucia',
  'Dmitri',
  null,
];

/** Ten reviews, newest first at index 0, a day apart. */
export const reviewRows: ReviewRow[] = bodies.map((body, index) => ({
  id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
  rating: index === 4 ? 4 : index === 8 ? 3 : 5,
  body,
  createdAt: new Date(Date.UTC(2026, 10, 12 - index, 15)),
  guestName: names[index] === null ? null : `${String(names[index])} Surname`,
}));

const view = reviewsView({ average: 4.6, count: 12 }, reviewRows);
if (view === null) throw new Error('The fixture is above the threshold');

/** What the block draws for twelve reviews averaging 4.6. */
export const reviewsFixture = view;
