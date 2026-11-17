import { personas } from '../personas';
import type { ReviewFixture } from '../reviews';

// Past bookings for the review demo. Each is a confirmed booking of a session that already took
// place, so its booker may review it. Nine carry a review, spread over four experiences (the
// kayak trip has five, enough to clear the display threshold); two belong to the guest persona and
// carry none, so signing in as the guest and opening the review invite leaves a real review to write.
// Reviewer addresses are on `.test`, which RFC 2606 reserves, so nothing reaches a real inbox.

const reviewerDomain = 'ramble.test';
const reviewer = (name: string) => `${name}@${reviewerDomain}`;

export const reviewFixtures: readonly ReviewFixture[] = [
  {
    key: 'kayak-1',
    experienceSlug: 'sunset-kayak-on-the-hudson',
    bookerEmail: reviewer('reviewer.noor'),
    bookerName: 'Noor Haddad',
    daysAgo: 9,
    seats: 2,
    review: {
      rating: 5,
      body: 'We paddled out as the sun dropped behind Jersey and the guide had us rafted up for the best of it. Gear was clean, the briefing was clear, and I never felt rushed. Booking again for visitors.',
    },
  },
  {
    key: 'kayak-2',
    experienceSlug: 'sunset-kayak-on-the-hudson',
    bookerEmail: reviewer('reviewer.tomas'),
    bookerName: 'Tomas Reyes',
    daysAgo: 16,
    seats: 1,
    review: {
      rating: 4,
      body: 'Beautiful light and a friendly group. The current picked up on the way back, which made it a workout, so wear something you can move in. The guide handled it calmly.',
    },
  },
  {
    key: 'kayak-3',
    experienceSlug: 'sunset-kayak-on-the-hudson',
    bookerEmail: reviewer('reviewer.imani'),
    bookerName: 'Imani Brooks',
    daysAgo: 23,
    seats: 2,
    review: {
      rating: 5,
      body: 'First time in a kayak and I was nervous. The warm-up on flat water made all the difference. Great photos from the guide too.',
    },
  },
  {
    key: 'kayak-4',
    experienceSlug: 'sunset-kayak-on-the-hudson',
    bookerEmail: reviewer('reviewer.callum'),
    bookerName: 'Callum Doyle',
    daysAgo: 31,
    seats: 2,
    review: {
      rating: 3,
      body: 'Lovely spot, but the meeting point was hard to find and we started ten minutes late. Once we were on the water it was well worth it.',
    },
  },
  {
    key: 'kayak-5',
    experienceSlug: 'sunset-kayak-on-the-hudson',
    bookerEmail: reviewer('reviewer.priya'),
    bookerName: 'Priya Nair',
    daysAgo: 44,
    seats: 3,
    review: {
      rating: 5,
      body: 'Booked for my sister, her partner, and me. Everyone was looked after, and nobody was left behind when the wind came up.',
    },
  },
  {
    key: 'wheel-1',
    experienceSlug: 'wheel-throwing-for-beginners',
    bookerEmail: reviewer('reviewer.hana'),
    bookerName: 'Hana Sato',
    daysAgo: 12,
    seats: 1,
    review: {
      rating: 5,
      body: 'Centered a lump of clay on my first attempt, which the instructor assured me never happens. Left with a wobbly bowl I love.',
    },
  },
  {
    key: 'wheel-2',
    experienceSlug: 'wheel-throwing-for-beginners',
    bookerEmail: reviewer('reviewer.felix'),
    bookerName: 'Felix Adler',
    daysAgo: 27,
    seats: 2,
    review: {
      rating: 4,
      body: 'Small class, plenty of one-to-one help. My cup collapsed twice and the instructor made it funny rather than embarrassing.',
    },
  },
  {
    key: 'pasta-1',
    experienceSlug: 'hand-rolled-pasta-in-carroll-gardens',
    bookerEmail: reviewer('reviewer.lucia'),
    bookerName: 'Lucia Ferrante',
    daysAgo: 20,
    seats: 2,
    review: {
      rating: 5,
      body: 'We made three shapes and ate every one of them with a glass of wine. The host explains the why behind each step, not just the how.',
    },
  },
  {
    key: 'coffee-1',
    experienceSlug: 'coffee-cupping-in-williamsburg',
    bookerEmail: reviewer('reviewer.dmitri'),
    bookerName: 'Dmitri Volkov',
    daysAgo: 6,
    seats: 1,
    review: {
      rating: 4,
      body: 'I now know what people mean by "stone fruit" in a cup. A little more time for questions at the end would have made it a five.',
    },
  },
  // The guest persona's finished sessions, with no review yet.
  {
    key: 'guest-cast-iron',
    experienceSlug: 'cast-iron-and-cobblestones',
    bookerEmail: personas.guest.email,
    bookerName: personas.guest.name,
    daysAgo: 5,
    seats: 2,
    review: null,
  },
  {
    key: 'guest-sound-bath',
    experienceSlug: 'sunday-sound-bath',
    bookerEmail: personas.guest.email,
    bookerName: personas.guest.name,
    daysAgo: 8,
    seats: 1,
    review: null,
  },
];
