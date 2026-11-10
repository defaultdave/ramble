import type { ExperienceFixture } from '../types';
import { experience } from './experiences';

// Nine more guide entries (PRD-13) beside the coverage set's sourdough class: hosts who are not
// bookable on Ramble, so each page links out, sells nothing, and has no sessions or prices. Some carry
// an affiliate link, as the brief's guide pages did (Q-15). The addresses are on example.com, which
// is reserved and goes nowhere.

type Guide = {
  slug: string;
  hostSlug: string;
  categorySlug: string;
  neighborhoodSlug: string;
  name: string;
  description: string;
  meetingPoint: string;
  durationMinutes: number;
  linkOutUrl: string;
  affiliate?: boolean;
};

function guide(input: Guide): ExperienceFixture {
  const { slug, hostSlug, categorySlug, neighborhoodSlug, name, description } =
    input;
  return experience(
    { slug, hostSlug, categorySlug, neighborhoodSlug, name, description },
    {
      status: 'guide_only',
      meetingPoint: input.meetingPoint,
      durationMinutes: input.durationMinutes,
      linkOutUrl: input.linkOutUrl,
      affiliateUrl: input.affiliate ? `${input.linkOutUrl}?ref=ramble` : null,
    },
  );
}

export const guideExperiences: ExperienceFixture[] = [
  guide({
    slug: 'letterpress-card-night-at-quill-and-ink',
    hostSlug: 'quill-and-ink-press',
    categorySlug: 'ceramics-and-crafts',
    neighborhoodSlug: 'lower-east-side',
    name: 'Letterpress card night at Quill & Ink',
    description:
      'Set a few lines of type by hand, ink the press, and pull a stack of cards that look like nothing you can buy. The shop runs it on weekday evenings with a handful of seats. Book with the press.',
    meetingPoint: 'Quill & Ink Press, Lower East Side.',
    durationMinutes: 120,
    linkOutUrl: 'https://quill-and-ink-press.example.com/classes/letterpress',
    affiliate: true,
  }),
  guide({
    slug: 'bookbinding-afternoon-at-quill-and-ink',
    hostSlug: 'quill-and-ink-press',
    categorySlug: 'ceramics-and-crafts',
    neighborhoodSlug: 'lower-east-side',
    name: 'Bookbinding afternoon at Quill & Ink',
    description:
      'Fold, sew, and glue a small notebook with a linen spine. A relaxed Sunday class for people who like their tools old and their paper heavy.',
    meetingPoint: 'Quill & Ink Press, Lower East Side.',
    durationMinutes: 180,
    linkOutUrl: 'https://quill-and-ink-press.example.com/classes/bookbinding',
  }),
  guide({
    slug: 'oyster-shucking-lesson-at-old-pier',
    hostSlug: 'old-pier-oyster-bar',
    categorySlug: 'food-and-coffee',
    neighborhoodSlug: 'tribeca',
    name: 'Oyster shucking lesson at Old Pier',
    description:
      'Learn to shuck at the raw bar: where the knife goes, how to keep the liquor in the shell, and what to pour beside a dozen. One of our favorite early-evening plans below Canal.',
    meetingPoint: 'Old Pier Oyster Bar, Tribeca.',
    durationMinutes: 90,
    linkOutUrl: 'https://old-pier-oyster-bar.example.com/lessons',
    affiliate: true,
  }),
  guide({
    slug: 'martinis-and-a-short-history',
    hostSlug: 'old-pier-oyster-bar',
    categorySlug: 'wine-and-cocktails',
    neighborhoodSlug: 'tribeca',
    name: 'Martinis and a short history',
    description:
      'A short history of the martini, told with three of them. The bar pours slowly and talks fast, and the snacks are a real plate, not a bowl of peanuts.',
    meetingPoint: 'Old Pier Oyster Bar, Tribeca.',
    durationMinutes: 75,
    linkOutUrl: 'https://old-pier-oyster-bar.example.com/lessons/martini',
  }),
  guide({
    slug: 'saturday-easy-run-in-sunset-park',
    hostSlug: 'fifth-avenue-run-club',
    categorySlug: 'outdoors',
    neighborhoodSlug: 'sunset-park',
    name: 'Saturday easy run in Sunset Park',
    description:
      'An easy run up the hill to the park and back, at a pace where you can still talk. All speeds are welcome, and the group waits at every corner.',
    meetingPoint: 'The corner of Fifth Avenue and 44th Street, Sunset Park.',
    durationMinutes: 60,
    linkOutUrl: 'https://fifth-avenue-run-club.example.com/saturday-run',
  }),
  guide({
    slug: 'post-run-stretch-on-the-grass',
    hostSlug: 'fifth-avenue-run-club',
    categorySlug: 'wellness',
    neighborhoodSlug: 'sunset-park',
    name: 'Post-run stretch on the grass',
    description:
      'Fifteen minutes of stretching on the grass after the run, led by whoever volunteers. Bring a mat if you have one, and stay for the coffee.',
    meetingPoint: 'The lawn at the top of the hill, Sunset Park.',
    durationMinutes: 30,
    linkOutUrl: 'https://fifth-avenue-run-club.example.com/stretch',
  }),
  guide({
    slug: 'long-table-supper-in-williamsburg',
    hostSlug: 'sunday-supper-club',
    categorySlug: 'cooking',
    neighborhoodSlug: 'williamsburg',
    name: 'Long table supper in Williamsburg',
    description:
      'A home cook, a long table, and a menu that changes with the market. Bring a bottle if you like, and leave with the recipe for whatever you liked best.',
    meetingPoint:
      "A home cook's apartment in Williamsburg. The host sends the address when you book.",
    durationMinutes: 180,
    linkOutUrl: 'https://sunday-supper-club.example.com/suppers',
    affiliate: true,
  }),
  guide({
    slug: 'pie-crust-morning-in-williamsburg',
    hostSlug: 'sunday-supper-club',
    categorySlug: 'cooking',
    neighborhoodSlug: 'williamsburg',
    name: 'Pie crust morning in Williamsburg',
    description:
      'A flaky-crust morning with a home baker who has rolled out a thousand of them. You roll, crimp, and carry a small pie home still warm.',
    meetingPoint:
      "A home baker's kitchen in Williamsburg. The host sends the address when you book.",
    durationMinutes: 150,
    linkOutUrl: 'https://sunday-supper-club.example.com/pie',
  }),
  guide({
    slug: 'kids-pizza-saturday-in-carroll-gardens',
    hostSlug: 'sunday-supper-club',
    categorySlug: 'kids',
    neighborhoodSlug: 'carroll-gardens',
    name: 'Kids pizza Saturday in Carroll Gardens',
    description:
      "A relaxed Saturday where kids make personal pizzas at a home cook's counter. Grown-ups stay, and there's coffee.",
    meetingPoint:
      "A home cook's kitchen in Carroll Gardens. The host sends the address when you book.",
    durationMinutes: 90,
    linkOutUrl: 'https://sunday-supper-club.example.com/kids-pizza',
  }),
];
