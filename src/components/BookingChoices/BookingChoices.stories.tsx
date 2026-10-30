import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { BookingPanel } from '@/components/BookingPanel';
import { BookingSheet } from '@/components/BookingSheet';
import { holdNote } from '@/lib/booking';
import {
  bookingReducer,
  canContinue,
  choicesView,
  initialState,
  lowestPriceMinor,
  type BookingAction,
  type BookingOffer,
} from '@/lib/bookingDraft';
import {
  kayakOffer,
  kidsOffer,
  optionId,
  twentyOneOffer,
} from '@/lib/bookingDraft.fixtures';
import { describeReserve } from '@/lib/bookingOutcome';
import type { ReserveResult } from '@/lib/holds';
import {
  BookingChoices,
  BookingFooter,
  BookingModeSwitch,
  BookingPausedNotice,
} from './BookingChoices';
import styles from './BookingChoices.stories.module.css';

// Each story is one state of the choices, built by the same reducer the page runs: the panel from the
// tablet width (Figma D03) and the sheet on a phone (Figma 04, 04b, 04c), with the answers of the
// reserve (S4, S5) and the paused state.
const meta = {
  title: 'Experience/BookingChoices',
  parameters: {
    a11y: {
      config: {
        // Every story renders twice, once per color scheme, so landmarks and ids repeat.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'duplicate-id', enabled: false },
          { id: 'duplicate-id-aria', enabled: false },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const evening = (n: number): BookingAction[] => [
  { type: 'chooseDate', date: '2026-10-24' },
  { type: 'chooseSession', sessionId: optionId(100 + n) },
];

function stateAfter(offer: BookingOffer, actions: BookingAction[]) {
  return actions.reduce(
    (state, action) => bookingReducer(offer, state, action),
    initialState(offer),
  );
}

const reserved = (offer: BookingOffer, result: ReserveResult) =>
  describeReserve(result, {
    checkoutBase: offer.checkoutBase,
    maxSeats: offer.maxSeats,
    deviceSeatLimit: offer.deviceSeatLimit,
  });

const handlers = {
  onDate: fn(),
  onSession: fn(),
  onAdults: fn(),
  onChildren: fn(),
  onAlternative: fn(),
};

function Panel({
  offer = kayakOffer,
  actions = [],
}: {
  offer?: BookingOffer;
  actions?: BookingAction[];
}) {
  const state = stateAfter(offer, actions);
  const view = choicesView(offer, state);
  const { summary } = view;
  return (
    <BookingPanel
      priceMinor={lowestPriceMinor(offer)}
      mode={<BookingModeSwitch mode={view.mode} onMode={fn()} />}
      {...(summary && canContinue(offer, state)
        ? {
            total: {
              label: summary.label,
              amountMinor: summary.totalMinor,
              ...(summary.terms ? { terms: summary.terms } : {}),
            },
          }
        : {})}
      holdNote={holdNote}
      onContinue={fn()}
    >
      <BookingChoices
        view={view}
        similarHref={offer.similarHref}
        {...handlers}
      />
    </BookingPanel>
  );
}

function Sheet({
  offer = kayakOffer,
  actions = [],
}: {
  offer?: BookingOffer;
  actions?: BookingAction[];
}) {
  const state = stateAfter(offer, actions);
  const view = choicesView(offer, state);
  return (
    <BookingSheet
      open
      title={offer.title}
      onClose={fn()}
      footer={
        <BookingFooter
          summary={view.summary}
          canContinue={canContinue(offer, state)}
          pending={false}
          onContinue={fn()}
        />
      }
    >
      <div className={styles.content}>
        <div className={styles.mode}>
          <BookingModeSwitch mode={view.mode} onMode={fn()} />
        </div>
        <BookingChoices
          view={view}
          similarHref={offer.similarHref}
          {...handlers}
        />
      </div>
    </BookingSheet>
  );
}

const soldOut = (offer: BookingOffer = kayakOffer): BookingAction => ({
  type: 'submitDone',
  origin: 'phone',
  effect: reserved(offer, {
    status: 'sold_out',
    alternatives: [
      {
        sessionId: optionId(501),
        startsAt: '2026-11-07T19:00:00Z',
        timeZone: 'America/New_York',
        spacesLeft: 6,
      },
      {
        sessionId: optionId(502),
        startsAt: '2026-11-08T19:00:00Z',
        timeZone: 'America/New_York',
        spacesLeft: 2,
      },
    ],
  }),
});

const answer = (result: ReserveResult): BookingAction => ({
  type: 'submitDone',
  origin: 'phone',
  effect: reserved(kayakOffer, result),
});

// ---- The panel, from the tablet width ----

export const PanelNothingChosen: Story = { render: () => <Panel /> };
export const PanelTimeChosen: Story = {
  render: () => <Panel actions={evening(3)} />,
};
// The adult is free and takes no space, so a child is needed (Figma 04b).
export const PanelKids: Story = {
  render: () => <Panel offer={kidsOffer} actions={evening(3)} />,
};
// 21 and over, with the ID check said before booking (Figma 04c).
export const PanelTwentyOnePlus: Story = {
  render: () => <Panel offer={twentyOneOffer} actions={evening(3)} />,
};
export const PanelGiftNotOpen: Story = {
  render: () => (
    <Panel actions={[...evening(3), { type: 'setMode', mode: 'gift' }]} />
  ),
};

// S5: the spaces went before the hold was placed, and other dates are offered.
export const PanelSoldOutBeforeHold: Story = {
  render: () => <Panel actions={[...evening(3), soldOut()]} />,
};
export const PanelSoldOutNoOtherDate: Story = {
  render: () => (
    <Panel
      actions={[
        ...evening(3),
        answer({ status: 'sold_out', alternatives: [] }),
      ]}
    />
  ),
};
// S4: three holds lapsed, so the block says when it ends.
export const PanelBlockedUntil: Story = {
  render: () => (
    <Panel
      actions={[
        ...evening(3),
        answer({
          status: 'blocked',
          reason: 'too_many_holds',
          until: '2026-10-24T19:42:00Z',
        }),
      ]}
    />
  ),
};
export const PanelDeviceLimit: Story = {
  render: () => (
    <Panel
      actions={[
        ...evening(3),
        answer({ status: 'blocked', reason: 'device_limit' }),
      ]}
    />
  ),
};
export const PanelBotRefused: Story = {
  render: () => (
    <Panel
      actions={[
        ...evening(3),
        answer({ status: 'blocked', reason: 'too_many_holds' }),
      ]}
    />
  ),
};
export const PanelSessionCancelled: Story = {
  render: () => (
    <Panel
      actions={[
        ...evening(3),
        answer({ status: 'unavailable', reason: 'session_cancelled' }),
      ]}
    />
  ),
};

// ---- The sheet, on a phone ----

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
// An open overlay covers the page, so each scheme gets its own story.
const light = { colorScheme: 'light' } as const;
const dark = { colorScheme: 'dark' } as const;

export const SheetTimeChosenLight: Story = {
  render: () => <Sheet actions={evening(3)} />,
  globals: mobile,
  parameters: light,
};
export const SheetTimeChosenDark: Story = {
  render: () => <Sheet actions={evening(3)} />,
  globals: mobile,
  parameters: dark,
};
export const SheetKids: Story = {
  render: () => <Sheet offer={kidsOffer} actions={evening(3)} />,
  globals: mobile,
  parameters: light,
};
export const SheetTwentyOnePlus: Story = {
  render: () => <Sheet offer={twentyOneOffer} actions={evening(3)} />,
  globals: mobile,
  parameters: light,
};
export const SheetSoldOutBeforeHold: Story = {
  render: () => <Sheet actions={[...evening(3), soldOut()]} />,
  globals: mobile,
  parameters: light,
};
export const SheetBlockedUntil: Story = {
  render: () => (
    <Sheet
      actions={[
        ...evening(3),
        answer({
          status: 'blocked',
          reason: 'too_many_holds',
          until: '2026-10-24T19:42:00Z',
        }),
      ]}
    />
  ),
  globals: mobile,
  parameters: dark,
};
export const SheetPaused: Story = {
  render: () => (
    <BookingSheet open title={kayakOffer.title} onClose={fn()}>
      <BookingPausedNotice />
    </BookingSheet>
  ),
  globals: mobile,
  parameters: light,
};
