import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { samplePhoto } from '@/components/Photo/Photo.fixtures';
import type { ExperienceCard } from '@/lib/experienceCards';
import type { GuideEntryView } from '@/lib/pages/guide';
import { GuideEntry } from './GuideEntry';
import { GuideRelated } from './GuideRelated';

const entry: GuideEntryView = {
  title: 'Sourdough mornings at Rise Bakery',
  about: [
    'A neighborhood bakery that opens its kitchen on Saturday mornings for a hands-on loaf.',
    'Bring an apron. Starter and flour are on the house.',
  ],
  hostName: 'Rise Bakery',
  neighborhoodName: 'Park Slope',
  categoryName: 'Cooking',
  duration: '2.5 hr',
  outbound: { href: 'https://rise.example/classes', sponsored: false },
  cover: samplePhoto(0),
};

const cards: ExperienceCard[] = [
  {
    id: '1',
    kind: 'bookable',
    title: 'Hand-rolled pasta in a Carroll Gardens kitchen',
    meta: 'Carroll Gardens · 2.5 hr',
    href: '/experiences/pasta-1',
    price: 'From $60',
    image: null,
  },
  {
    id: '2',
    kind: 'bookable',
    title: 'Dumpling folding with a Sunset Park chef',
    meta: 'Sunset Park · 2 hr',
    href: '/experiences/dumplings-2',
    price: '$60',
    image: null,
  },
];

// One story per state of the guide entry page: a plain link out, an affiliate link, no link, no photo, and no module.
const meta = {
  title: 'Experience/GuideEntry',
  component: GuideEntry,
  args: {
    entry,
    related: <GuideRelated categoryName="Cooking" cards={cards} />,
  },
  parameters: {
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme, so landmarks and ids repeat.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof GuideEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

export const LinkOutMobile: Story = { globals: mobile };
export const LinkOutDesktop: Story = {
  globals: desktop,
  parameters: fullWidth,
};
export const AffiliateMobile: Story = {
  args: {
    entry: {
      ...entry,
      outbound: { href: 'https://aff.example/rise', sponsored: true },
    },
  },
  globals: mobile,
};
export const NoLinkMobile: Story = {
  args: { entry: { ...entry, outbound: null } },
  globals: mobile,
};
export const NoPhotoMobile: Story = {
  args: { entry: { ...entry, cover: null, about: [] } },
  globals: mobile,
};
// Nothing bookable in the category, or the module still streaming in.
export const NoModuleMobile: Story = {
  args: { related: null },
  globals: mobile,
};
