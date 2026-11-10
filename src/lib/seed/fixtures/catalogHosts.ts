import type { HostFixture } from '../types';

// Nine more fictional hosts for the curated catalog: five that sell on Ramble and four that are guide
// only (PRD-13) and take their own bookings. Together with the coverage set's eleven they make twenty.
// Every name, address, and sentence is made up for Ramble; none comes from a real business.

export const catalogHosts: HostFixture[] = [
  {
    slug: 'spoke-and-saddle',
    name: 'Spoke & Saddle',
    description:
      'Two cycling teachers who lead small, unhurried rides along the New York waterfront. Bikes and helmets included, and nobody gets dropped.',
  },
  {
    slug: 'second-pour',
    name: 'Second Pour',
    description:
      'A Lower East Side bar with a back room for classes. The bartenders teach what they actually make at the rail.',
  },
  {
    slug: 'thimble-and-thread',
    name: 'Thimble & Thread',
    description:
      'A Carroll Gardens workshop for people who like making useful things. Two big tables, a wall of fabric, and patient teachers.',
  },
  {
    slug: 'stoop-garden-club',
    name: 'Stoop Garden Club',
    description:
      'A volunteer-run garden in Park Slope. Anyone can come and get their hands dirty, and the vegetables go to neighbors.',
  },
  {
    slug: 'corner-table-tours',
    name: 'Corner Table Tours',
    description:
      'Neighbors who walk and eat their way around south and west Brooklyn and take a few guests along. They only visit counters and kitchens they go to themselves.',
  },
  {
    slug: 'quill-and-ink-press',
    name: 'Quill & Ink Press',
    description:
      'A one-room letterpress shop on the Lower East Side that opens its presses for weeknight and Sunday classes. Ramble lists them; the shop takes the bookings.',
  },
  {
    slug: 'old-pier-oyster-bar',
    name: 'Old Pier Oyster Bar',
    description:
      'A narrow Tribeca bar with a raw bar and a short list of classes. Ramble lists them for now; book with the bar.',
  },
  {
    slug: 'fifth-avenue-run-club',
    name: 'Fifth Avenue Run Club',
    description:
      'A friendly run group that meets in Sunset Park. Ramble lists the Saturday runs; the club keeps its own sign-up.',
  },
  {
    slug: 'sunday-supper-club',
    name: 'Sunday Supper Club',
    description:
      'A rotating cast of home cooks who open their tables in Williamsburg and Carroll Gardens. Ramble lists their dinners and classes; each cook takes their own bookings.',
  },
];
