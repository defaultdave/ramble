import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ExperienceError, ExperiencePage } from '@/components/ExperiencePage';
import {
  UpcomingSessions,
  UpcomingSessionsSkeleton,
} from '@/components/UpcomingSessions';
import { mixed } from '@/components/UpcomingSessions/UpcomingSessions.fixtures';
import {
  bareExperience,
  kidsClass,
  sunsetKayak,
} from './ExperiencePage.fixtures';

// One story per state of the experience page, on a phone (Figma 03) and from the tablet width (D03),
// plus the error state (S3) beside the listing pages' own.
const meta = {
  title: 'Experience/ExperiencePage',
  component: ExperiencePage,
  args: { view: sunsetKayak, dates: <UpcomingSessions view={mixed} /> },
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
} satisfies Meta<typeof ExperiencePage>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };
// Two color schemes side by side would halve the page, so a desktop story shows the light one at full width.
const fullWidth = { ...meta.parameters, colorScheme: 'light' } as const;

export const OutdoorMobile: Story = { globals: mobile };
export const OutdoorDesktop: Story = {
  globals: desktop,
  parameters: fullWidth,
};
// The dates still streaming in: the skeleton holds the rows' height.
export const LoadingDatesMobile: Story = {
  args: { dates: <UpcomingSessionsSkeleton /> },
  globals: mobile,
};
export const LoadingDatesDesktop: Story = {
  args: { dates: <UpcomingSessionsSkeleton /> },
  globals: desktop,
  parameters: fullWidth,
};
export const KidsClassMobile: Story = {
  args: { view: kidsClass },
  globals: mobile,
};
export const KidsClassDesktop: Story = {
  args: { view: kidsClass },
  globals: desktop,
  parameters: fullWidth,
};
export const BareMobile: Story = {
  args: { view: bareExperience },
  globals: mobile,
};
export const BareDesktop: Story = {
  args: { view: bareExperience },
  globals: desktop,
  parameters: fullWidth,
};

type ErrorStory = StoryObj<typeof ExperienceError>;

export const ErrorMobile: ErrorStory = {
  render: () => <ExperienceError retryHref="/experiences/sunset-kayak-1" />,
  globals: mobile,
  parameters: {
    a11y: { config: { rules: [{ id: 'landmark-unique', enabled: false }] } },
  },
};
export const ErrorDesktop: ErrorStory = {
  render: () => <ExperienceError retryHref="/experiences/sunset-kayak-1" />,
  globals: desktop,
  parameters: {
    colorScheme: 'light',
    a11y: { config: { rules: [{ id: 'landmark-unique', enabled: false }] } },
  },
};
