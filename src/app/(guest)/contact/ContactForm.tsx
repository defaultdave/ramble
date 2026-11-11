'use client';

import { TriangleAlert } from 'lucide-react';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { FormGuardFields } from '@/components/FormGuardFields';
import { Input } from '@/components/Input';
import {
  emptySupportValues,
  supportLimits,
  supportTopicLabels,
  supportTopics,
  type SupportFieldErrors,
  type SupportFormState,
} from '@/lib/support';
import { submitSupportRequest } from '@/server/actions/contact';
import styles from './ContactForm.module.css';

type ContactFormProps = {
  /** From `issueFormGuardToken`, called when the page renders. */
  token: string;
};

const idle: SupportFormState = { status: 'idle' };

/** A label, the control, and the error for one field the shared Input does not cover. */
function Field({
  label,
  errorText,
  children,
}: {
  label: string;
  errorText: string | undefined;
  children: (props: {
    id: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': errorText ? true : undefined,
        'aria-describedby': errorText ? errorId : undefined,
      })}
      {errorText ? (
        <p className={styles.error} id={errorId}>
          <TriangleAlert className={styles.errorIcon} aria-hidden="true" />
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

/** The shared Input takes an absent error, not an undefined one. */
const errorProp = (message: string | undefined) =>
  message ? { errorText: message } : {};

const notices = {
  rate_limited: {
    tone: 'warning',
    title: 'You have sent a few messages already',
    body: 'Please wait a while before sending another. Your message has not been sent.',
  },
  expired: {
    tone: 'warning',
    title: 'This form has been open for a long time',
    body: 'Send it again to refresh it. Your message is still here.',
  },
  failed: {
    tone: 'danger',
    title: 'Your message was not sent',
    body: 'Something went wrong on our side. Please try again in a moment.',
  },
} as const;

function noticeFor(state: SupportFormState) {
  switch (state.status) {
    case 'rate_limited':
    case 'expired':
    case 'failed':
      return notices[state.status];
    default:
      return null;
  }
}

export function ContactForm({ token }: ContactFormProps) {
  const [state, formAction, pending] = useActionState(
    submitSupportRequest,
    idle,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // A refusal moves focus to what the guest must act on, so a screen reader announces it and a
  // keyboard user does not have to hunt for it.
  useEffect(() => {
    if (state.status === 'invalid') {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    } else if (state.status !== 'idle') {
      noticeRef.current?.focus();
    }
  }, [state]);

  if (state.status === 'sent') {
    return (
      <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
        <Alert
          tone="success"
          title="Thanks, your message is on its way"
          body="We read every message and reply by email, usually within a couple of working days."
          action={
            <ButtonLink href="/help" variant="secondary">
              Back to the help center
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const values = state.status === 'idle' ? emptySupportValues : state.values;
  const errors: SupportFieldErrors =
    state.status === 'invalid' ? state.errors : {};
  const notice = noticeFor(state);

  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      {notice ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert tone={notice.tone} title={notice.title} body={notice.body} />
        </div>
      ) : null}
      <FormGuardFields token={token} />
      <Input
        name="name"
        label="Your name"
        autoComplete="name"
        defaultValue={values.name}
        {...errorProp(errors.name)}
        maxLength={supportLimits.nameMaxChars}
        required
      />
      <Input
        name="email"
        type="email"
        label="Your email"
        hint="We reply here. We do not use it for anything else."
        autoComplete="email"
        defaultValue={values.email}
        {...errorProp(errors.email)}
        required
      />
      <Field label="What is this about?" errorText={errors.topic}>
        {(control) => (
          <select
            {...control}
            // React reads a select's default only when it mounts, so a new value remounts it.
            key={values.topic}
            name="topic"
            className={styles.control}
            defaultValue={values.topic}
            required
          >
            <option value="" disabled>
              Choose one
            </option>
            {supportTopics.map((topic) => (
              <option key={topic} value={topic}>
                {supportTopicLabels[topic]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Your message" errorText={errors.message}>
        {(control) => (
          <textarea
            {...control}
            name="message"
            className={styles.control}
            rows={6}
            defaultValue={values.message}
            maxLength={supportLimits.messageMaxChars}
            required
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        Send message
      </Button>
    </form>
  );
}
