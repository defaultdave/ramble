'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { FormGuardFields } from '@/components/FormGuardFields';
import { Input } from '@/components/Input';
import { Textarea } from '@/components/Textarea';
import {
  emptyPrivateSessionValues,
  privateSessionFields,
  privateSessionLimits,
  type PrivateSessionField,
  type PrivateSessionFieldErrors,
  type PrivateSessionFormState,
} from '@/lib/privateSession';
import { requestPrivateSession } from '@/server/actions/privateSession';
import styles from './PrivateSessionForm.module.css';

type PrivateSessionFormProps = {
  /** From `issueFormGuardToken`, called when the page renders. */
  token: string;
  experienceId: string;
  /** Back to the experience page, offered once the request is sent. */
  experienceHref: string;
  /** New York's calendar date today, the earliest date the form takes. */
  minDate: string;
};

const idle: PrivateSessionFormState = { status: 'idle' };

const fieldLabels = {
  date: 'Preferred date',
  groupSize: 'Group size',
  budget: 'Budget',
  name: 'Your name',
  email: 'Your email',
  message: 'Anything else the host should know',
} satisfies Record<PrivateSessionField, string>;

const fieldId = (field: PrivateSessionField) => `private-session-${field}`;

/** The shared Input takes an absent error, not an undefined one. */
const errorProp = (message: string | undefined) =>
  message ? { errorText: message } : {};

const notices = {
  rate_limited: {
    tone: 'warning',
    title: 'You have sent a few requests already',
    body: 'Please wait a while before sending another. Your request has not been sent.',
  },
  expired: {
    tone: 'warning',
    title: 'This form has been open for a long time',
    body: 'Send it again to refresh it. Your answers are still here.',
  },
  failed: {
    tone: 'danger',
    title: 'Your request was not sent',
    body: 'Something went wrong on our side. Please try again in a moment.',
  },
} as const;

function noticeFor(state: PrivateSessionFormState) {
  switch (state.status) {
    case 'rate_limited':
    case 'expired':
    case 'failed':
      return notices[state.status];
    default:
      return null;
  }
}

function ErrorSummary({ errors }: { errors: PrivateSessionFieldErrors }) {
  const entries = privateSessionFields.flatMap((field) => {
    const message = errors[field];
    return message ? [{ field, message }] : [];
  });
  return (
    <Alert
      tone="danger"
      title="Check these answers"
      body={
        <ul className={styles.summaryList}>
          {entries.map(({ field, message }) => (
            <li key={field}>
              <a href={`#${fieldId(field)}`}>
                {fieldLabels[field]}: {message}
              </a>
            </li>
          ))}
        </ul>
      }
    />
  );
}

export function PrivateSessionForm({
  token,
  experienceId,
  experienceHref,
  minDate,
}: PrivateSessionFormProps) {
  const [state, formAction, pending] = useActionState(
    requestPrivateSession,
    idle,
  );
  const noticeRef = useRef<HTMLDivElement>(null);

  // A refusal moves focus to the summary or notice, so a screen reader announces it and a keyboard
  // user does not have to hunt for it.
  useEffect(() => {
    if (state.status !== 'idle') noticeRef.current?.focus();
  }, [state]);

  if (state.status === 'sent') {
    return (
      <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
        <Alert
          tone="success"
          title="Thanks, your request is on its way"
          body="We pass it to the host and reply by email, usually within a couple of working days."
          action={
            <ButtonLink href={experienceHref} variant="secondary">
              Back to the experience
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const values =
    state.status === 'idle' ? emptyPrivateSessionValues : state.values;
  const errors: PrivateSessionFieldErrors =
    state.status === 'invalid' ? state.errors : {};
  const notice = noticeFor(state);

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.status === 'invalid' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <ErrorSummary errors={errors} />
        </div>
      ) : null}
      {notice ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert tone={notice.tone} title={notice.title} body={notice.body} />
        </div>
      ) : null}
      <FormGuardFields token={token} />
      <input type="hidden" name="experienceId" value={experienceId} />
      <Input
        id={fieldId('date')}
        name="date"
        type="date"
        label={fieldLabels.date}
        min={minDate}
        defaultValue={values.date}
        {...errorProp(errors.date)}
        required
      />
      <div className={styles.pair}>
        <Input
          id={fieldId('groupSize')}
          name="groupSize"
          type="number"
          inputMode="numeric"
          label={fieldLabels.groupSize}
          min={1}
          max={privateSessionLimits.maxGroupSize}
          defaultValue={values.groupSize}
          {...errorProp(errors.groupSize)}
          required
        />
        <Input
          id={fieldId('budget')}
          name="budget"
          inputMode="numeric"
          label={fieldLabels.budget}
          hint="In whole dollars, for the whole group."
          defaultValue={values.budget}
          {...errorProp(errors.budget)}
          required
        />
      </div>
      <Input
        id={fieldId('name')}
        name="name"
        label={fieldLabels.name}
        autoComplete="name"
        defaultValue={values.name}
        maxLength={privateSessionLimits.nameMaxChars}
        {...errorProp(errors.name)}
        required
      />
      <Input
        id={fieldId('email')}
        name="email"
        type="email"
        label={fieldLabels.email}
        hint="The host replies here. We do not use it for anything else."
        autoComplete="email"
        defaultValue={values.email}
        {...errorProp(errors.email)}
        required
      />
      <Textarea
        id={fieldId('message')}
        name="message"
        label={fieldLabels.message}
        rows={5}
        defaultValue={values.message}
        maxLength={privateSessionLimits.messageMaxChars}
        {...errorProp(errors.message)}
        optional
      />
      <Button type="submit" size="lg" loading={pending}>
        Send request
      </Button>
    </form>
  );
}
