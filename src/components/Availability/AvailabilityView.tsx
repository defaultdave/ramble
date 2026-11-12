import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import {
  availabilityFieldProblems,
  seatsMaxLength,
  slotsIntro,
  startTimeHint,
  templateSourceOptions,
  weekdayChoices,
  weekdayFieldName,
  type AvailabilityFormField,
  type AvailabilitySlotView,
} from '@/lib/availability';
import { errorProps, problemText } from '@/lib/opsForm';
import styles from './Availability.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type AvailabilityViewProps = {
  experienceId: string;
  /** The host's zone, which every start time is read in. */
  timeZone: string;
  slots: readonly AvailabilitySlotView[];
  /** The fields the last add needed another look at, which the page read from the address. */
  problems?: readonly AvailabilityFormField[];
  addSlots: FormAction;
  saveSeats: FormAction;
};

/** The weekly slots of an experience with the seats each sells, and the plain forms that change a slot's seats and add new slots. */
export function AvailabilityView({
  experienceId,
  timeZone,
  slots,
  problems = [],
  addSlots,
  saveSeats,
}: AvailabilityViewProps) {
  const errorFor = (field: AvailabilityFormField) =>
    errorProps(problems, availabilityFieldProblems, field);
  const weekdaysProblem = problemText(
    problems,
    availabilityFieldProblems,
    'weekdays',
  );
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="availability-slots">
        <h2 className={styles.heading} id="availability-slots">
          Weekly slots
        </h2>
        <p className={styles.muted}>{slotsIntro(timeZone)}</p>
        {slots.length === 0 ? (
          <p className={styles.muted}>
            This experience has no weekly slots yet.
          </p>
        ) : (
          <ul className={styles.list}>
            {slots.map((slot) => (
              <li key={slot.id} className={styles.row}>
                <p className={styles.slotTitle}>
                  {slot.weekdayLabel} at {slot.timeLabel}, {slot.durationLabel}
                </p>
                <p className={styles.muted}>
                  {slot.sourceLabel}. {slot.upcomingLabel}.
                </p>
                <form
                  action={saveSeats}
                  className={styles.seatsForm}
                  noValidate
                >
                  <input
                    type="hidden"
                    name="experienceId"
                    value={experienceId}
                  />
                  <input type="hidden" name="templateId" value={slot.id} />
                  <Input
                    name="allocation"
                    label={`Seats, ${slot.weekdayLabel} ${slot.timeLabel}`}
                    inputMode="numeric"
                    defaultValue={String(slot.allocation)}
                    maxLength={seatsMaxLength}
                    autoComplete="off"
                    required
                  />
                  <Button type="submit" variant="secondary">
                    Save seats
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form action={addSlots} className={styles.form} noValidate>
        <input type="hidden" name="experienceId" value={experienceId} />
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Add weekly slots</legend>
          <fieldset className={styles.group}>
            <legend className={styles.muted}>Days of the week</legend>
            {weekdayChoices.map(({ day, label }) => (
              <CheckField
                key={day}
                name={weekdayFieldName(day)}
                label={label}
              />
            ))}
            {weekdaysProblem ? (
              <p role="alert" className={styles.muted}>
                {weekdaysProblem}
              </p>
            ) : null}
          </fieldset>
          <Input
            name="startTime"
            label="Start time"
            hint={startTimeHint(timeZone)}
            autoComplete="off"
            required
            {...errorFor('startTime')}
          />
          <Input
            name="durationMinutes"
            label="Length in minutes"
            inputMode="numeric"
            autoComplete="off"
            required
            {...errorFor('durationMinutes')}
          />
          <Input
            name="allocation"
            label="Seats per session"
            hint="The most guests Ramble may book on each session. Set it to what the host’s own system can hold for Ramble."
            inputMode="numeric"
            autoComplete="off"
            required
            {...errorFor('allocation')}
          />
          <Select
            name="source"
            label="Whose seats"
            placeholder="Choose whose seats"
            options={templateSourceOptions}
            defaultValue=""
            required
            {...errorFor('source')}
          />
        </fieldset>
        <Button type="submit" size="lg">
          Add slots
        </Button>
      </form>
    </div>
  );
}
