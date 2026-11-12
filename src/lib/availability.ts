import {
  experienceNotices,
  experiencePath,
  labelledOptions,
} from './experienceEditor';
import {
  fieldsFromIssues,
  formHas,
  formText,
  formWholeNumber,
  parseIdField,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import {
  AddSlotsInputSchema,
  UpdateTemplateAllocationInputSchema,
  maxAllocation,
  maxSessionMinutes,
  type AddSlotsInput,
  type SessionTemplate,
  type UpdateTemplateAllocationInput,
} from './sessions';
import { countLabel } from './text';

// Availability setup on the ops experience page: the weekly slots and the seats each one sells, as
// ops reads and posts them. A slot is a template (a weekday, a start time on the host's wall clock,
// a length) with a seat cap, and its source says whether the seats are Ramble's own or an allocation
// the host's own system hands over. The rules for what a change may do to sessions already made
// are in `sessions.ts`; the generator is the one the rolling job runs.

export function availabilityPath(experienceId: string): string {
  return `${experiencePath(experienceId)}/availability`;
}

/** Monday first, as a week reads on the host's calendar. The numbers are the template's: 0 is Sunday. */
export const weekdayChoices = [
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' },
  { day: 0, label: 'Sunday' },
] as const;

const weekdayLabels = new Map<number, string>(
  weekdayChoices.map(({ day, label }) => [day, label]),
);

export const weekdayFieldName = (day: number) => `weekday${String(day)}`;

type TemplateSource = SessionTemplate['source'];

const templateSourceLabels = {
  ramble: 'Ramble sells the host’s own seats',
  allocation: 'A block of seats the host’s own system gives Ramble',
} as const satisfies Record<TemplateSource, string>;

export const templateSourceOptions = labelledOptions(templateSourceLabels);

export const availabilityFormFields = [
  'weekdays',
  'startTime',
  'durationMinutes',
  'allocation',
  'source',
] as const;
export type AvailabilityFormField = (typeof availabilityFormFields)[number];

export const availabilityFieldProblems = {
  weekdays: 'Choose at least one day of the week.',
  startTime: 'Enter a start time like 14:00, in the host’s time zone.',
  durationMinutes: `Enter the length in minutes, from 1 to ${String(maxSessionMinutes)}.`,
  allocation: `Enter a whole number of seats, from 0 to ${String(maxAllocation)}.`,
  source: 'Choose whose seats these are.',
} as const satisfies Record<AvailabilityFormField, string>;

/** The schema stores a start as HH:MM:00; the input the data layer takes is the HH:MM a person types. */
function startTimeOf(stored: string): string {
  return stored.slice(0, 5);
}

/** The most digits a seat count can have, for the field's length limit. */
export const seatsMaxLength = String(maxAllocation).length;

export function slotsIntro(timeZone: string): string {
  return `Start times are on the host’s clock in ${timeZone}. The daily job keeps every slot open twelve weeks ahead.`;
}

export function startTimeHint(timeZone: string): string {
  return `Like 14:00, on the host’s clock in ${timeZone}.`;
}

export type AddSlotsForm =
  | { status: 'ready'; input: AddSlotsInput }
  | { status: 'invalid'; fields: AvailabilityFormField[] };

/** The slots a posted form asks for: one per ticked weekday, all with the form's start time, length, seats and source. */
export function parseAddSlotsForm(
  get: FormGetter,
  experienceId: string,
): AddSlotsForm {
  const raw = {
    experienceId,
    weekdays: weekdayChoices
      .map(({ day }) => day)
      .filter((day) => formHas(get, weekdayFieldName(day))),
    startTime: formText(get, 'startTime'),
    durationMinutes: formWholeNumber(get, 'durationMinutes'),
    allocation: formWholeNumber(get, 'allocation'),
    source: formText(get, 'source'),
  };
  const parsed = AddSlotsInputSchema.safeParse(raw);
  return parsed.success
    ? {
        status: 'ready',
        input: {
          ...parsed.data,
          startTime: startTimeOf(parsed.data.startTime),
        },
      }
    : {
        status: 'invalid',
        fields: fieldsFromIssues(parsed.error.issues, availabilityFormFields),
      };
}

export type SeatsForm =
  | { status: 'ready'; input: UpdateTemplateAllocationInput }
  | { status: 'invalid' };

/** The new seat cap a posted form asks for on the slot it names. The id is read by the action, so a form with none never gets here. */
export function parseSeatsForm(get: FormGetter): SeatsForm {
  const parsed = UpdateTemplateAllocationInputSchema.safeParse({
    templateId: parseIdField(get('templateId')),
    allocation: formWholeNumber(get, 'allocation'),
  });
  return parsed.success
    ? { status: 'ready', input: parsed.data }
    : { status: 'invalid' };
}

export const availabilityNoticeCodes = [
  'added',
  'seats_saved',
  'seats_unchanged',
  'invalid',
  'duplicate_slot',
  'below_sold_and_held',
  'invalid_time_zone',
  'slot_gone',
] as const;
export type AvailabilityNoticeCode = (typeof availabilityNoticeCodes)[number];

export const availabilityNotices = {
  added: {
    tone: 'success',
    title: 'Slots added. Their sessions are open for the weeks ahead.',
  },
  seats_saved: {
    tone: 'success',
    title:
      'Seats saved. Upcoming sessions that followed the old number have the new one.',
  },
  seats_unchanged: {
    tone: 'info',
    title: 'The seats were already that number, so nothing was saved.',
  },
  invalid: experienceNotices.invalid,
  duplicate_slot: {
    tone: 'danger',
    title:
      'This experience already has a slot at one of those days and times. Nothing was added.',
  },
  below_sold_and_held: {
    tone: 'danger',
    title:
      'Some upcoming sessions already have more seats booked or being paid for than that. Choose a higher number, or deal with those bookings first.',
  },
  invalid_time_zone: {
    tone: 'danger',
    title:
      'The host’s time zone is not set up correctly, so nothing was added. Fix it on the host first.',
  },
  slot_gone: {
    tone: 'danger',
    title: 'That slot is no longer there. Reload the page.',
  },
} as const satisfies Record<AvailabilityNoticeCode, NoticeText>;

/** What the data layer hands over for one slot: the template and what its upcoming sessions look like. */
export type AvailabilitySlot = Pick<
  SessionTemplate,
  'id' | 'weekday' | 'startTime' | 'durationMinutes' | 'allocation' | 'source'
> & {
  /** Scheduled sessions from this slot that have not started. */
  upcoming: number;
  /** The date of the last of them, or null when there are none. */
  lastDate: string | null;
};

export type AvailabilityData = {
  experienceId: string;
  experienceName: string;
  hostName: string;
  timeZone: string;
  slots: readonly AvailabilitySlot[];
};

export type AvailabilitySlotView = {
  id: string;
  weekdayLabel: string;
  /** "10:00", on the host's wall clock. */
  timeLabel: string;
  durationLabel: string;
  sourceLabel: string;
  allocation: number;
  /** "12 sessions open, through 2027-02-06". */
  upcomingLabel: string;
};

function upcomingLabel(slot: AvailabilitySlot): string {
  return slot.upcoming === 0 || slot.lastDate === null
    ? 'No upcoming sessions yet'
    : `${countLabel(slot.upcoming, 'session')} open, through ${slot.lastDate}`;
}

/** The slots in week order, Monday first, then by start time. */
export function buildAvailabilityView(data: AvailabilityData): {
  slots: AvailabilitySlotView[];
  timeZone: string;
} {
  const rank = (day: number) => (day + 6) % 7;
  const ordered = data.slots
    .toSorted(
      (a, b) =>
        rank(a.weekday) - rank(b.weekday) ||
        a.startTime.localeCompare(b.startTime),
    )
    .map((slot) => ({
      id: slot.id,
      weekdayLabel: weekdayLabels.get(slot.weekday) ?? '',
      timeLabel: slot.startTime.slice(0, 5),
      durationLabel: countLabel(slot.durationMinutes, 'minute'),
      sourceLabel: templateSourceLabels[slot.source],
      allocation: slot.allocation,
      upcomingLabel: upcomingLabel(slot),
    }));
  return { slots: ordered, timeZone: data.timeZone };
}
