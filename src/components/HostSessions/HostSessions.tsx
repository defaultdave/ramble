'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { AccountControl } from '@/components/Header/AccountControl';
import { Button, ButtonLink } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageHeading } from '@/components/PageHeading';
import { Select } from '@/components/Select';
import {
  hostSessionFailureMessage,
  type HostSessionFieldErrors,
  type HostSessionFormState,
  type HostWeekRowView,
  type HostWeekView,
} from '@/lib/hostSessions';
import styles from './HostSessions.module.css';

export const hostSessionsTitle = 'Sessions';

type HostSessionAction = (
  previous: HostSessionFormState,
  formData: FormData,
) => Promise<HostSessionFormState>;

export type HostSessionActions = {
  publishWeek: HostSessionAction;
  updateCapacity: HostSessionAction;
  updateTime: HostSessionAction;
  updatePrice: HostSessionAction;
  cancelSession: HostSessionAction;
  addOneOff: HostSessionAction;
};

const idle: HostSessionFormState = { status: 'idle' };

type ActionFormProps = {
  action: HostSessionAction;
  submitLabel: string;
  variant?: 'primary' | 'secondary';
  children: (errors: HostSessionFieldErrors) => ReactNode;
};

/** One form and its answer. A result moves focus to its notice, or to the first field to fix, so it is announced. */
function ActionForm({
  action,
  submitLabel,
  variant = 'primary',
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, idle);
  const formRef = useRef<HTMLFormElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === 'invalid') {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    } else if (state.status !== 'idle') {
      noticeRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      {state.status === 'done' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert tone="success" title={state.message} />
        </div>
      ) : null}
      {state.status === 'problem' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert tone="warning" title="Not saved" body={state.message} />
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert
            tone="danger"
            title="Not saved"
            body={hostSessionFailureMessage}
          />
        </div>
      ) : null}
      {children(state.status === 'invalid' ? state.errors : {})}
      <Button type="submit" variant={variant} loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

function SessionIds({ row }: { row: HostWeekRowView }) {
  return (
    <>
      <input type="hidden" name="sessionId" value={row.id} />
      <input type="hidden" name="expectedVersion" value={row.version} />
    </>
  );
}

function EditSession({
  row,
  actions,
}: {
  row: HostWeekRowView;
  actions: HostSessionActions;
}) {
  return (
    <details className={styles.edit}>
      <summary>
        Change {row.experienceName} at {row.timeLabel}
      </summary>
      <ActionForm action={actions.updateCapacity} submitLabel="Save capacity">
        {(errors) => (
          <>
            <SessionIds row={row} />
            <Input
              name="allocation"
              label="Capacity (seats)"
              inputMode="numeric"
              defaultValue={String(row.allocation)}
              hint="It cannot go below the seats booked or being paid for."
              {...(errors.allocation ? { errorText: errors.allocation } : {})}
            />
          </>
        )}
      </ActionForm>
      {row.adultPrice === null ? null : (
        <ActionForm action={actions.updatePrice} submitLabel="Save price">
          {(errors) => (
            <>
              <input type="hidden" name="sessionId" value={row.id} />
              <Input
                name="price"
                label="Adult price (dollars)"
                inputMode="decimal"
                defaultValue={row.adultPrice ?? ''}
                hint="It applies to every session of this experience, for new bookings only."
                {...(errors.price ? { errorText: errors.price } : {})}
              />
            </>
          )}
        </ActionForm>
      )}
      {row.movable ? (
        <>
          <ActionForm action={actions.updateTime} submitLabel="Save time">
            {(errors) => (
              <>
                <SessionIds row={row} />
                <Input
                  name="startTime"
                  type="time"
                  label="Start time"
                  defaultValue={row.startTime}
                  {...(errors.startTime ? { errorText: errors.startTime } : {})}
                />
                <Input
                  name="durationMinutes"
                  label="Length (minutes)"
                  inputMode="numeric"
                  defaultValue={String(row.durationMinutes)}
                  {...(errors.durationMinutes
                    ? { errorText: errors.durationMinutes }
                    : {})}
                />
              </>
            )}
          </ActionForm>
          <ActionForm
            action={actions.cancelSession}
            submitLabel="Cancel this session"
            variant="secondary"
          >
            {() => <SessionIds row={row} />}
          </ActionForm>
        </>
      ) : (
        <p className={styles.note}>
          Seats are booked, so the time cannot change and the session cannot be
          cancelled here.
        </p>
      )}
    </details>
  );
}

function SessionRow({
  row,
  actions,
}: {
  row: HostWeekRowView;
  actions: HostSessionActions;
}) {
  return (
    <li className={styles.row}>
      <p className={styles.primary}>{row.experienceName}</p>
      <p className={styles.secondary}>
        {row.timeLabel} · {row.statusLabel}
      </p>
      <p className={styles.secondary}>
        {row.soldLabel}
        {row.priceLabel ? ` · ${row.priceLabel}` : ''}
      </p>
      {row.editable ? <EditSession row={row} actions={actions} /> : null}
    </li>
  );
}

function AddOneOff({
  view,
  action,
}: {
  view: HostWeekView;
  action: HostSessionAction;
}) {
  return (
    <ActionForm action={action} submitLabel="Add session">
      {(errors) => (
        <>
          <Select
            name="experienceId"
            label="Experience"
            placeholder="Choose an experience"
            options={view.experiences.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            {...(errors.experienceId ? { errorText: errors.experienceId } : {})}
          />
          <Input
            name="localDate"
            type="date"
            label="Date"
            defaultValue={view.weekStart}
            {...(errors.localDate ? { errorText: errors.localDate } : {})}
          />
          <Input
            name="startTime"
            type="time"
            label="Start time"
            {...(errors.startTime ? { errorText: errors.startTime } : {})}
          />
          <Input
            name="durationMinutes"
            label="Length (minutes)"
            inputMode="numeric"
            defaultValue="120"
            {...(errors.durationMinutes
              ? { errorText: errors.durationMinutes }
              : {})}
          />
          <Input
            name="allocation"
            label="Capacity (seats)"
            inputMode="numeric"
            {...(errors.allocation ? { errorText: errors.allocation } : {})}
          />
        </>
      )}
    </ActionForm>
  );
}

/** The host's week: sessions by day with what may change on each, publishing the week from the weekly slots, and one-off dates. */
export function HostSessions({
  view,
  actions,
}: {
  view: HostWeekView;
  actions: HostSessionActions;
}) {
  return (
    <>
      <PageHeading title={hostSessionsTitle}>
        <p>{view.hostName}</p>
        <AccountControl signedIn />
      </PageHeading>
      <div className={styles.sections}>
        <nav aria-label="Week" className={styles.weekNav}>
          <p className={styles.week}>{view.weekLabel}</p>
          {view.prevHref ? (
            <ButtonLink href={view.prevHref} variant="secondary">
              Previous week
            </ButtonLink>
          ) : null}
          {view.thisWeekHref ? (
            <ButtonLink href={view.thisWeekHref} variant="secondary">
              This week
            </ButtonLink>
          ) : null}
          {view.nextHref ? (
            <ButtonLink href={view.nextHref} variant="secondary">
              Next week
            </ButtonLink>
          ) : null}
        </nav>
        <p className={styles.secondary}>Times are in {view.timeZone}.</p>
        <section>
          <h2 className={styles.heading}>Publish this week</h2>
          <p className={styles.secondary}>
            Sessions from your weekly slots are bookable as soon as they exist.
            Publishing adds any that are missing this week and leaves edited or
            cancelled ones as they are.
          </p>
          <ActionForm
            action={actions.publishWeek}
            submitLabel="Publish this week"
          >
            {() => (
              <input type="hidden" name="weekStart" value={view.weekStart} />
            )}
          </ActionForm>
        </section>
        <section>
          <h2 className={styles.heading}>Sessions</h2>
          {view.days.length === 0 ? (
            <p className={styles.empty}>No sessions this week.</p>
          ) : (
            view.days.map((day) => (
              <div key={day.date}>
                <h3 className={styles.day}>{day.label}</h3>
                <ul className={styles.list}>
                  {day.sessions.map((row) => (
                    <SessionRow key={row.id} row={row} actions={actions} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        <section>
          <h2 className={styles.heading}>Add a one-off session</h2>
          {view.experiences.length === 0 ? (
            <p className={styles.empty}>You have no experiences yet.</p>
          ) : (
            <AddOneOff view={view} action={actions.addOneOff} />
          )}
        </section>
      </div>
    </>
  );
}
