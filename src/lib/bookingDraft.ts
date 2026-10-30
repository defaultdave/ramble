import {
  describeReserve,
  type BookingNotice,
  type ReserveEffect,
} from './bookingOutcome';
import type {
  ReserveResult,
  ReserveSpacesInput,
  SessionSummary,
} from './holds';
import { formatPrice } from './money';
import { guestsLabel } from './orderSummary';
import { lines, type PricedOption } from './pricing';
import { spacesStatus } from './spaces';
import { calendarDateFormat } from './time';
import { zonedShortDayLabel, zonedTimeLabel } from './zonedLabels';

// The booking draft: the date, time, and party a guest chooses before a hold, and what the bar, sheet,
// and panel show of it. The hook `useBookingDraft` holds a `BookingState` and calls `bookingReducer`;
// every decision is here. The browser loads this file, so it imports no Zod (see `bookingOutcome.ts`).

export type BookingMode = 'book' | 'gift';

/** One bookable session as the choices draw it, labelled on the host's clock by the server. */
export type OfferedSession = {
  id: string;
  /** The session's own calendar date, YYYY-MM-DD. */
  date: string;
  /** "Sat, Oct 24". */
  dayLabel: string;
  /** "5:30 PM EDT". */
  timeLabel: string;
  spacesLeft: number;
  /** "Free cancellation until Fri, Oct 23, 5:30 PM EDT.", or null when the server has no deadline to state. */
  cancelNote: string | null;
};

/** Everything the choices need, as plain data the server hands to the client islands. */
export type BookingOffer = {
  experienceId: string;
  title: string;
  /** The venue's current date, YYYY-MM-DD, from the server clock. */
  today: string;
  options: Pick<PricedOption, 'id' | 'kind' | 'priceMinor' | 'usesSpace'>[];
  /** The ages a child may be, or null when children are not part of this booking (no child price, or an age rule that leaves none). */
  childAges: { min: number; max: number } | null;
  /** "Ages 14 and up", shown under the party. */
  ageNote: string;
  /** A 21+ experience says so beside the party, and that ID is checked at the door (PRD-23). */
  twentyOnePlus: boolean;
  /** The most spaces one booking takes; one device holds the same number (PRD-17). */
  maxSeats: number;
  giftsEnabled: boolean;
  /** Ops paused bookings (PRD-16). */
  paused: boolean;
  /** `/checkout/`: the route builder imports Zod, which the browser must not load. */
  checkoutBase: string;
  similarHref: string;
  privateSessionHref: string;
  sessions: OfferedSession[];
  /** `?date=` from the address, kept only when it is a date the offer lists. */
  preselectedDate: string | null;
};

export type BookingState = {
  mode: BookingMode;
  date: string | null;
  sessionId: string | null;
  adults: number;
  children: number;
  /** Other dates S5 offered, added to the offer's own sessions. */
  extra: OfferedSession[];
  /** Sessions a reserve found sold out, cancelled, or started: shown as unavailable from then on. */
  closed: string[];
  /** Ops paused bookings after the page was drawn. */
  paused: boolean;
  sheetOpen: boolean;
  pending: boolean;
  notice: BookingNotice | null;
  /** The other dates S5 offers, as the buttons in the notice. */
  alternatives: SessionSummary[];
};

const defaultAdults = 2;

type Option = BookingOffer['options'][number];

function optionOf(offer: BookingOffer, kind: Option['kind']) {
  return offer.options.find((option) => option.kind === kind);
}

/** The sessions the guest can see: the offer's, and the other dates S5 added. */
function allSessions(offer: BookingOffer, state: BookingState) {
  const known = new Set<string>();
  return [...offer.sessions, ...state.extra].filter(({ id }) => {
    if (known.has(id)) return false;
    known.add(id);
    return true;
  });
}

function isBookable(session: OfferedSession, state: BookingState): boolean {
  return (
    spacesStatus(session.spacesLeft) !== 'sold-out' &&
    !state.closed.includes(session.id)
  );
}

export function sessionOf(
  offer: BookingOffer,
  state: BookingState,
): OfferedSession | null {
  return (
    allSessions(offer, state).find(({ id }) => id === state.sessionId) ?? null
  );
}

// ---- The party ----

type Seats = { adults: number; children: number };

/** The spaces a party takes: only a price option that uses a space counts (a free adult beside a child takes none). */
function seatsOf(offer: BookingOffer, { adults, children }: Seats): number {
  const adult = optionOf(offer, 'adult');
  const child = optionOf(offer, 'child');
  return (
    (adult?.usesSpace ? adults : 0) +
    (child?.usesSpace && offer.childAges ? children : 0)
  );
}

const childrenOffered = (offer: BookingOffer) =>
  offer.childAges !== null && optionOf(offer, 'child') !== undefined;

/** An adult always comes; a child comes only with one. A party that would take no space needs a child (the free adult beside a child). */
function minimums(offer: BookingOffer): Seats {
  const adults = optionOf(offer, 'adult') ? 1 : 0;
  const needsChild =
    childrenOffered(offer) && seatsOf(offer, { adults, children: 0 }) < 1;
  return { adults, children: needsChild ? 1 : 0 };
}

/** The spaces a party may take: the most one booking takes, and what the chosen session has left. */
function seatCap(offer: BookingOffer, session: OfferedSession | null): number {
  return session
    ? Math.min(offer.maxSeats, Math.max(0, session.spacesLeft))
    : offer.maxSeats;
}

/** A party brought inside the minimums and the cap, children giving way first. */
function fitParty(
  offer: BookingOffer,
  session: OfferedSession | null,
  party: Seats,
): Seats {
  const min = minimums(offer);
  const cap = seatCap(offer, session);
  let adults = Math.min(Math.max(party.adults, min.adults), offer.maxSeats);
  let children = childrenOffered(offer)
    ? Math.min(Math.max(party.children, min.children), offer.maxSeats)
    : 0;
  while (seatsOf(offer, { adults, children }) > cap) {
    if (children > min.children) children -= 1;
    else if (adults > min.adults) adults -= 1;
    else break;
  }
  return { adults, children };
}

type StepperView = {
  value: number;
  min: number;
  max: number;
  /** The line under the label, or null for none. */
  hint: string | null;
};

type PartyView = {
  adults: StepperView;
  /** Null when children are not part of this booking. */
  children: StepperView | null;
  /** What checkout will ask, beside the steppers: each child's age. */
  note: string | null;
  /** The 21+ rule, said before the guest books. */
  ageAlert: { title: string; body: string } | null;
};

function largest(
  from: number,
  to: number,
  fits: (value: number) => boolean,
): number {
  for (let value = to; value > from; value -= 1) {
    if (fits(value)) return value;
  }
  return from;
}

function partyView(
  offer: BookingOffer,
  state: BookingState,
  session: OfferedSession,
): PartyView {
  const min = minimums(offer);
  const cap = seatCap(offer, session);
  const { adults, children } = state;
  const offeredChildren = childrenOffered(offer);
  return {
    adults: {
      value: adults,
      hint: offeredChildren ? null : offer.ageNote,
      min: min.adults,
      max: largest(
        min.adults,
        offer.maxSeats,
        (value) => seatsOf(offer, { adults: value, children }) <= cap,
      ),
    },
    children: offeredChildren
      ? {
          value: children,
          hint: offer.childAges
            ? `Ages ${String(offer.childAges.min)} to ${String(offer.childAges.max)}`
            : null,
          min: min.children,
          max: largest(
            min.children,
            offer.maxSeats,
            (value) => seatsOf(offer, { adults, children: value }) <= cap,
          ),
        }
      : null,
    note: offeredChildren ? "You'll add each child's age at checkout." : null,
    ageAlert: offer.twentyOnePlus
      ? {
          title: '21 and over',
          body: "ID is checked at the door. You'll confirm everyone in your party is 21 or older at checkout.",
        }
      : null,
  };
}

// ---- The state ----

function openSessions(offer: BookingOffer, state: BookingState) {
  return allSessions(offer, state).filter((session) =>
    isBookable(session, state),
  );
}

/** The dates with a session that can still be booked, in the order the sessions come. */
function availableDates(offer: BookingOffer, state: BookingState): string[] {
  return [...new Set(openSessions(offer, state).map(({ date }) => date))];
}

function sessionsOn(offer: BookingOffer, state: BookingState, date: string) {
  return openSessions(offer, state).filter((session) => session.date === date);
}

/** The state a page starts in: `?date=` chosen when the offer lists it, and the lone time on that date chosen with it. */
export function initialState(offer: BookingOffer): BookingState {
  const blank: BookingState = {
    mode: 'book',
    date: null,
    sessionId: null,
    adults: defaultAdults,
    children: 0,
    extra: [],
    closed: [],
    paused: offer.paused,
    sheetOpen: false,
    pending: false,
    notice: null,
    alternatives: [],
  };
  return offer.preselectedDate === null
    ? blank
    : withDate(offer, blank, offer.preselectedDate);
}

function withDate(
  offer: BookingOffer,
  state: BookingState,
  date: string,
): BookingState {
  if (!availableDates(offer, state).includes(date)) return state;
  const times = sessionsOn(offer, state, date);
  const only = times.length === 1 ? (times[0] ?? null) : null;
  return {
    ...state,
    date,
    sessionId: only?.id ?? null,
    notice: null,
    alternatives: [],
    ...fitParty(offer, only, state),
  };
}

export type BookingAction =
  | { type: 'chooseDate'; date: string }
  | { type: 'chooseSession'; sessionId: string }
  | { type: 'setAdults'; value: number }
  | { type: 'setChildren'; value: number }
  | { type: 'setMode'; mode: BookingMode }
  | { type: 'chooseAlternative'; summary: SessionSummary }
  | { type: 'openSheet' }
  | { type: 'closeSheet' }
  | { type: 'submitStarted' }
  | { type: 'submitDone'; effect: ReserveEffect };

/** A session's date and the labels the choices show, on its own calendar and clock. */
export function sessionLabels(startsAt: Date, timeZone: string) {
  return {
    date: calendarDateFormat(timeZone).format(startsAt),
    dayLabel: zonedShortDayLabel(startsAt, timeZone),
    timeLabel: zonedTimeLabel(startsAt, timeZone),
  };
}

function sessionFromSummary(summary: SessionSummary): OfferedSession {
  return {
    id: summary.sessionId,
    ...sessionLabels(new Date(summary.startsAt), summary.timeZone),
    spacesLeft: summary.spacesLeft,
    cancelNote: null,
  };
}

function afterReserve(
  offer: BookingOffer,
  state: BookingState,
  effect: ReserveEffect,
): BookingState {
  switch (effect.kind) {
    case 'held':
      // Pending stays on until the navigation to checkout leaves the page.
      return { ...state, notice: null, alternatives: [] };
    case 'paused':
      return {
        ...state,
        pending: false,
        paused: true,
        notice: null,
        alternatives: [],
      };
    case 'notice': {
      const tried = state.sessionId;
      const closing = effect.closeSession && tried !== null;
      const next: BookingState = {
        ...state,
        pending: false,
        notice: effect.notice,
        alternatives: effect.alternatives,
        extra: [...state.extra, ...effect.alternatives.map(sessionFromSummary)],
        closed: closing ? [...state.closed, tried] : state.closed,
        sessionId: closing ? null : state.sessionId,
      };
      return {
        ...next,
        date:
          next.date !== null && !availableDates(offer, next).includes(next.date)
            ? null
            : next.date,
        sheetOpen: true,
      };
    }
  }
}

/** Every change to the draft, as a pure function of the offer, the state, and the action. */
export function bookingReducer(
  offer: BookingOffer,
  state: BookingState,
  action: BookingAction,
): BookingState {
  switch (action.type) {
    case 'chooseDate':
      return withDate(offer, state, action.date);
    case 'chooseSession': {
      if (state.sessionId === action.sessionId) {
        return { ...state, sessionId: null };
      }
      const session = allSessions(offer, state).find(
        ({ id }) => id === action.sessionId,
      );
      if (!session || !isBookable(session, state)) return state;
      return {
        ...state,
        date: session.date,
        sessionId: session.id,
        notice: null,
        alternatives: [],
        ...fitParty(offer, session, state),
      };
    }
    case 'setAdults':
      return {
        ...state,
        notice: null,
        ...fitParty(offer, sessionOf(offer, state), {
          adults: action.value,
          children: state.children,
        }),
      };
    case 'setChildren':
      return {
        ...state,
        notice: null,
        ...fitParty(offer, sessionOf(offer, state), {
          adults: state.adults,
          children: action.value,
        }),
      };
    case 'setMode':
      return { ...state, mode: action.mode, notice: null, alternatives: [] };
    case 'chooseAlternative': {
      const withIt = bookingReducer(offer, state, {
        type: 'chooseSession',
        sessionId: action.summary.sessionId,
      });
      return withIt.sessionId === action.summary.sessionId ? withIt : state;
    }
    case 'openSheet':
      return { ...state, sheetOpen: true };
    case 'closeSheet':
      return { ...state, sheetOpen: false };
    case 'submitStarted':
      return { ...state, pending: true, notice: null, alternatives: [] };
    case 'submitDone':
      return afterReserve(offer, state, action.effect);
  }
}

// ---- What is drawn ----

type TimeView = {
  id: string;
  time: string;
  spacesLeft: number;
  selected: boolean;
};

export type Summary = {
  /** "Sat, Oct 24 · 2:00 PM EDT". */
  when: string;
  guests: number;
  /** The tickets, in integer minor units; any tax is worked out at checkout. */
  totalMinor: number;
  /** "$65 × 2 guests", or "1 adult, 2 children". */
  label: string;
  /** The cancellation line. */
  terms: string | null;
};

export type ChoicesView = {
  mode: BookingMode;
  /** The book or gift switch shows only while gifts are on. */
  showModeSwitch: boolean;
  today: string;
  date: string | null;
  availableDates: string[];
  /** The times on the chosen date, or null while no date is chosen. */
  timesHeading: string | null;
  times: TimeView[] | null;
  /** The party, once a time is chosen. */
  party: PartyView | null;
  summary: Summary | null;
  notice: BookingNotice | null;
  alternatives: SessionSummary[];
};

function summaryOf(
  offer: BookingOffer,
  state: BookingState,
  session: OfferedSession,
): Summary {
  const { adults, children } = state;
  const items = [
    { kind: 'adult' as const, quantity: adults },
    { kind: 'child' as const, quantity: children },
  ].flatMap(({ kind, quantity }) => {
    const option = optionOf(offer, kind);
    return option && quantity > 0
      ? [{ priceOptionId: option.id, quantity }]
      : [];
  });
  const priced = lines(items, offer.options, 0);
  const adult = optionOf(offer, 'adult');
  const label =
    children === 0 && adult
      ? `${formatPrice(adult.priceMinor)} × ${guestsLabel(adults)}`
      : `${countLabel(adults, 'adult')}, ${countLabel(children, 'child', 'children')}`;
  return {
    when: `${session.dayLabel} · ${session.timeLabel}`,
    guests: adults + children,
    totalMinor: priced.ticketSubtotalMinor,
    label,
    terms: session.cancelNote,
  };
}

function countLabel(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function choicesView(
  offer: BookingOffer,
  state: BookingState,
): ChoicesView {
  const session = sessionOf(offer, state);
  const times =
    state.date === null
      ? null
      : sessionsOn(offer, state, state.date).map(
          ({ id, timeLabel, spacesLeft }) => ({
            id,
            time: timeLabel,
            spacesLeft,
            selected: id === state.sessionId,
          }),
        );
  const chosenDay = allSessions(offer, state).find(
    ({ date }) => date === state.date,
  );
  return {
    mode: state.mode,
    showModeSwitch: offer.giftsEnabled,
    today: offer.today,
    date: state.date,
    availableDates: availableDates(offer, state),
    timesHeading: chosenDay ? `Time on ${chosenDay.dayLabel}` : null,
    times,
    party: session ? partyView(offer, state, session) : null,
    summary:
      session && state.mode === 'book'
        ? summaryOf(offer, state, session)
        : null,
    notice: state.notice,
    alternatives: state.alternatives,
  };
}

/** Whether Continue can place the hold: a bookable session and a party that fits it, in book mode. */
export function canContinue(offer: BookingOffer, state: BookingState): boolean {
  const session = sessionOf(offer, state);
  return (
    state.mode === 'book' &&
    !state.paused &&
    session !== null &&
    isBookable(session, state)
  );
}

/** The request `reserveSpaces` takes, or null when the draft is not ready to hold. */
export function reserveInput(
  offer: BookingOffer,
  state: BookingState,
): ReserveSpacesInput | null {
  const session = sessionOf(offer, state);
  if (!session || !canContinue(offer, state)) return null;
  const items = [
    { kind: 'adult' as const, quantity: state.adults },
    { kind: 'child' as const, quantity: state.children },
  ].flatMap(({ kind, quantity }) => {
    const option = optionOf(offer, kind);
    return option && quantity > 0
      ? [{ priceOptionId: option.id, quantity }]
      : [];
  });
  return { sessionId: session.id, items, purpose: 'booking' };
}

/** The effect of an answer to the draft's own request. */
export function effectOf(
  offer: BookingOffer,
  result: ReserveResult,
): ReserveEffect {
  return describeReserve(result, {
    checkoutBase: offer.checkoutBase,
    maxSeats: offer.maxSeats,
  });
}

// ---- The bar ----

export type BarView =
  | { state: 'paused' }
  | { state: 'sold-out' }
  | {
      state: 'date-chosen';
      when: string;
      guests: number;
      totalMinor: number;
    }
  | { state: 'default'; priceMinor: number; nextDate: string | null };

/** The lowest per-person price among the options that take a space; every option when none does. */
export function lowestPriceMinor(offer: BookingOffer): number {
  const paying = offer.options.filter((option) => option.usesSpace);
  const pool = paying.length > 0 ? paying : offer.options;
  return Math.min(...pool.map((option) => option.priceMinor));
}

/** `availability.state` of the design doc: paused, sold out, a date chosen, or nothing chosen yet. */
export function barView(offer: BookingOffer, state: BookingState): BarView {
  if (state.paused) return { state: 'paused' };
  const open = openSessions(offer, state);
  if (open.length === 0) return { state: 'sold-out' };
  const session = sessionOf(offer, state);
  if (session && state.mode === 'book' && isBookable(session, state)) {
    const summary = summaryOf(offer, state, session);
    return {
      state: 'date-chosen',
      when: summary.when,
      guests: summary.guests,
      totalMinor: summary.totalMinor,
    };
  }
  return {
    state: 'default',
    priceMinor: lowestPriceMinor(offer),
    nextDate: open[0]?.dayLabel ?? null,
  };
}
