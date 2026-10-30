import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { browseParamNames, parseSingle, type RawSearchParams } from './filters';
import { cardPriceLabel, type CardPriceOption } from './pricing';
import { IsoDateSchema, TimeZoneSchema } from './sessions';
import { spacesLabel, spacesStatus, type SpacesStatus } from './spaces';
import { calendarDateFormat } from './time';
import { zonedShortDayLabel, zonedTimeLabel } from './zonedLabels';

/**
 * How much of an experience's schedule the page reads. A page lists the next few dates, not the
 * calendar (the booking sheet picks any date), so the read stops at the sixth session or ninety
 * days out, whichever comes first. Sold-out sessions count toward the six, so a full week stays
 * visible. The bounds also keep the spaces-left reads to one cached call per row.
 */
export const upcomingSessionLimits = { maxRows: 6, windowDays: 90 } as const;

/** What the data layer hands over for one session: when and where it starts. */
export const UpcomingSessionSchema = z.object({
  id: EntityIdSchema,
  startsAt: z.date(),
  timeZone: TimeZoneSchema,
});
export type UpcomingSession = z.infer<typeof UpcomingSessionSchema>;

/** A listed session with the spaces left in it for display, or null when no session guests can see has this ID. */
export type SessionWithSpaces = {
  session: UpcomingSession;
  spacesLeft: number | null;
};

export type SessionRowView = {
  id: string;
  /** "Sat, Oct 24", on the session's own calendar. */
  dayLabel: string;
  /** "5:30 PM EDT", on the session's own clock. */
  timeLabel: string;
  /** "8 spaces", "2 left", or "Sold out". */
  spacesLabel: string;
  status: SpacesStatus;
  /** The per-person price, or null when no option takes a space. */
  priceLabel: string | null;
  /** The row's date is the one the address asked for. */
  selected: boolean;
  /** Where the row goes, or null for a sold-out session, which stays listed but cannot be chosen. */
  href: string | null;
};

export type UpcomingSessionsView =
  { kind: 'rows'; rows: SessionRowView[] } | { kind: 'none' };

export type UpcomingSessionsInput = {
  sessions: readonly SessionWithSpaces[];
  priceOptions: readonly CardPriceOption[];
  selectedDate: string | null;
  bookHref: string;
};

/** The date the address asks for (`?date=YYYY-MM-DD`, as the checkout's links send it), or null when absent, repeated, or not a real date. */
export function selectedDateFrom(searchParams: RawSearchParams): string | null {
  return parseSingle(searchParams[browseParamNames.date], IsoDateSchema);
}

/**
 * The rows the page draws, soonest first as they arrive. A session guests cannot see (no spaces
 * figure) is left out; a sold-out one is kept and marked, with no link. Never more than
 * `maxRows`, whatever the data layer hands over.
 */
export function buildUpcomingSessions({
  sessions,
  priceOptions,
  selectedDate,
  bookHref,
}: UpcomingSessionsInput): UpcomingSessionsView {
  const priceLabel = cardPriceLabel(priceOptions);
  const rows = sessions
    .flatMap(({ session, spacesLeft }) =>
      spacesLeft === null ? [] : [{ session, spacesLeft }],
    )
    .slice(0, upcomingSessionLimits.maxRows)
    .map(({ session, spacesLeft }): SessionRowView => {
      const status = spacesStatus(spacesLeft);
      return {
        id: session.id,
        dayLabel: zonedShortDayLabel(session.startsAt, session.timeZone),
        timeLabel: zonedTimeLabel(session.startsAt, session.timeZone),
        spacesLabel: spacesLabel(spacesLeft),
        status,
        priceLabel,
        selected:
          selectedDate !== null &&
          calendarDateFormat(session.timeZone).format(session.startsAt) ===
            selectedDate,
        href: status === 'sold-out' ? null : bookHref,
      };
    });
  return rows.length === 0 ? { kind: 'none' } : { kind: 'rows', rows };
}
