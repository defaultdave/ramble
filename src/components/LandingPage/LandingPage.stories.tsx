import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BrowseResults } from '@/components/BrowseResults';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import type { ExperienceCard } from '@/lib/experienceCards';
import { LandingPage } from '.';

const cards: ExperienceCard[] = [
  {
    id: '1',
    image: null,
    kind: 'bookable',
    title: 'Hand-rolled pasta in a Carroll Gardens kitchen',
    meta: 'Carroll Gardens · 2.5 hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
  },
  {
    id: '2',
    image: null,
    kind: 'bookable',
    title: 'Dumpling folding with a Sunset Park chef',
    meta: 'Sunset Park · 2 hr',
    href: '/experiences/dumplings-2',
    price: '$60',
  },
  {
    id: '3',
    image: null,
    kind: 'guide-only',
    title: 'Sourdough mornings at Rise Bakery',
    meta: 'Park Slope',
    href: '/guide/sourdough-3',
    hostHref: 'https://host.example/sourdough',
  },
];

const results = (
  <BrowseResults
    state="results"
    cards={cards}
    summary="3 experiences"
    showMore={null}
    startHref={null}
  />
);

// The copy is rich text rendered on the server; plain paragraphs stand in for it here.
const intro = (
  <p>
    Roll pasta in Carroll Gardens, fold dumplings in Sunset Park, or stretch
    your own mozzarella. Small groups, real kitchens, and dinner more often than
    not.
  </p>
);
const body = (
  <>
    <p>
      These classes are taught by people who cook this food at home. You do the
      work with your own hands, and you eat what you make.
    </p>
    <p>
      Some bakeries and kitchens take bookings on their own sites. We list those
      too, clearly marked.
    </p>
  </>
);

// One story per state of a category or neighborhood page: with copy, with none yet, loading, nothing to list, and a failed read.
const meta = {
  title: 'Pages/LandingPage',
  component: LandingPage,
  args: {
    heading: 'Cooking classes in Brooklyn',
    intro,
    browseHref: '/new-york/browse?category=cooking',
    results,
    body,
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the state twice, once per color scheme, and the story has no <main> around
        // the header, as the page has, so each copy would be a banner.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof LandingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { colorScheme: 'light' } as const;

export const WithCopyMobile: Story = { globals: mobile };

export const WithCopyDesktop: Story = {
  globals: desktop,
  parameters: { ...meta.parameters, ...fullWidth },
};

export const WithoutCopy: Story = {
  args: {
    heading: 'Cooking experiences in New York',
    intro: null,
    body: null,
  },
  globals: mobile,
};

export const Loading: Story = {
  args: { results: <BrowseSkeleton filters={false} /> },
  globals: mobile,
};

export const NothingListed: Story = {
  args: {
    results: <BrowseResults state="empty" filtered dated={null} />,
  },
  globals: mobile,
};

export const ReadFailed: Story = {
  args: {
    results: (
      <BrowseResults
        state="error"
        retry={{ action: '/new-york/things-to-do/cooking', fields: [] }}
      />
    ),
  },
  globals: mobile,
};
