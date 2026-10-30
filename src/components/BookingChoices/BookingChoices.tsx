import { Gift } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { SimilarLink } from '@/components/BookingBar/SimilarLink';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DatePicker } from '@/components/DatePicker';
import { Stepper } from '@/components/Stepper';
import { TimeSlot } from '@/components/TimeSlot';
import { continueLabel, holdNote, pausedNotice } from '@/lib/booking';
import type { BookingMode, ChoicesView, Summary } from '@/lib/bookingDraft';
import { alternativeLabel } from '@/lib/bookingOutcome';
import type { SessionSummary } from '@/lib/holds';
import { formatMoney } from '@/lib/money';
import styles from './BookingChoices.module.css';

type BookingChoicesHandlers = {
  onDate: (date: string) => void;
  onSession: (sessionId: string) => void;
  onAdults: (value: number) => void;
  onChildren: (value: number) => void;
  onAlternative: (summary: SessionSummary) => void;
};

export type BookingChoicesProps = BookingChoicesHandlers & {
  view: ChoicesView;
  similarHref: string;
};

const hintOf = (hint: string | null) => (hint ? { hint } : {});

/** Book for me or give as a gift. The gift choice is there while gifts are on, and says it is not open yet. */
export function BookingModeSwitch({
  mode,
  onMode,
}: {
  mode: BookingMode;
  onMode: (mode: BookingMode) => void;
}) {
  return (
    <>
      <Chip
        selected={mode === 'book'}
        label="Book for me"
        onToggle={() => {
          onMode('book');
        }}
      />
      <Chip
        selected={mode === 'gift'}
        label="Give as a gift"
        iconStart={<Gift />}
        onToggle={() => {
          onMode('gift');
        }}
      />
    </>
  );
}

/**
 * The choices shared by the sheet and the panel: what the last answer said, then the date, the times
 * on it, and the party, each appearing once the one before it is chosen.
 */
export function BookingChoices({
  view,
  similarHref,
  onDate,
  onSession,
  onAdults,
  onChildren,
  onAlternative,
}: BookingChoicesProps) {
  const { notice, party, times } = view;
  return (
    <div className={styles.choices}>
      {notice ? (
        <Alert
          tone={notice.tone}
          title={notice.title}
          body={notice.body}
          action={
            view.alternatives.length > 0 ? (
              <div className={styles.alternatives}>
                {view.alternatives.map((summary) => (
                  <Button
                    key={summary.sessionId}
                    variant="secondary"
                    onClick={() => {
                      onAlternative(summary);
                    }}
                  >
                    {alternativeLabel(summary)}
                  </Button>
                ))}
              </div>
            ) : notice.similar ? (
              <SimilarLink
                href={similarHref}
                size="md"
                label="See similar experiences"
              />
            ) : undefined
          }
        />
      ) : null}
      {view.mode === 'gift' ? (
        <Alert
          tone="info"
          title="Gifts aren't open yet"
          body="You can't buy this as a gift just now. Switch back to book it for yourself."
        />
      ) : (
        <>
          <section className={styles.section}>
            <h3 className={styles.heading}>Pick a date</h3>
            <DatePicker
              label="Choose a date"
              value={view.date}
              today={view.today}
              availableDates={view.availableDates}
              onChange={onDate}
            />
          </section>
          {times && view.timesHeading ? (
            <section className={styles.section}>
              <h3 className={styles.heading}>{view.timesHeading}</h3>
              <div className={styles.times}>
                {times.map((slot) => (
                  <TimeSlot
                    key={slot.id}
                    time={slot.time}
                    spacesLeft={slot.spacesLeft}
                    selected={slot.selected}
                    onToggle={() => {
                      onSession(slot.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {party ? (
            <section className={styles.section}>
              <h3 className={styles.heading}>Who&apos;s coming</h3>
              <Stepper
                label={party.children ? 'Adults' : 'Guests'}
                {...hintOf(party.adults.hint)}
                value={party.adults.value}
                min={party.adults.min}
                max={party.adults.max}
                onChange={onAdults}
              />
              {party.children ? (
                <Stepper
                  label="Children"
                  {...hintOf(party.children.hint)}
                  value={party.children.value}
                  min={party.children.min}
                  max={party.children.max}
                  onChange={onChildren}
                />
              ) : null}
              {party.note ? <p className={styles.note}>{party.note}</p> : null}
              {party.ageAlert ? (
                <Alert
                  tone="info"
                  title={party.ageAlert.title}
                  body={party.ageAlert.body}
                />
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Bookings are paused: said in place of the choices. */
export function BookingPausedNotice() {
  return (
    <Alert tone="info" title={pausedNotice.title} body={pausedNotice.body} />
  );
}

/** Under the choices in the sheet: the total, the cancellation line, Continue, and how long spaces are held. */
export function BookingFooter({
  summary,
  canContinue,
  pending,
  onContinue,
}: {
  summary: Summary | null;
  canContinue: boolean;
  pending: boolean;
  onContinue: () => void;
}) {
  return (
    <div className={styles.footer}>
      {summary ? (
        <>
          <p className={styles.totalLine}>
            <span className={styles.totalLabel}>{summary.label}</span>
            <span className={styles.totalAmount}>
              {formatMoney(summary.totalMinor)}
            </span>
          </p>
          {summary.terms ? (
            <p className={styles.footerNote}>{summary.terms}</p>
          ) : null}
        </>
      ) : null}
      <div className={styles.footerAction}>
        <Button
          size="lg"
          disabled={!canContinue || summary === null}
          loading={pending}
          onClick={onContinue}
        >
          {summary ? continueLabel(summary.totalMinor) : 'Continue'}
        </Button>
      </div>
      <p className={styles.footerNote}>{holdNote}</p>
    </div>
  );
}
