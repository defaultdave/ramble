'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import {
  hostSessionFailureMessage,
  type HostSessionFieldErrors,
  type HostSessionFormState,
  type HostWeekRowView,
  type HostWeekView,
} from '@/lib/hostSessions';
import styles from './HostSessions.module.css';

// The forms are the only client code of the week page: each keeps its own answer and moves focus to
// it. The week, the days and the rows are rendered on the server.

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

export function EditSessionForms({
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

export function AddOneOffForm({
  view,
  action,
}: {
  view: Pick<HostWeekView, 'experiences' | 'weekStart'>;
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

export function PublishWeekForm({
  weekStart,
  action,
}: {
  weekStart: string;
  action: HostSessionAction;
}) {
  return (
    <ActionForm action={action} submitLabel="Publish this week">
      {() => <input type="hidden" name="weekStart" value={weekStart} />}
    </ActionForm>
  );
}
