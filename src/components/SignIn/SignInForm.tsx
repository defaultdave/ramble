'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Input } from '@/components/Input';
import {
  rateLimitBody,
  signInHref,
  signInSentBody,
  type SignInFormState,
} from '@/lib/signIn';
import styles from './SignIn.module.css';

export type SignInFormProps = {
  /** The Server Action that asks for the link. */
  action: (
    previous: SignInFormState,
    formData: FormData,
  ) => Promise<SignInFormState>;
  /** Where to land after sign-in. The server checks it again. */
  next: string;
  initialState?: SignInFormState;
};

const idle: SignInFormState = { status: 'idle' };

export function SignInForm({
  action,
  next,
  initialState = idle,
}: SignInFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // A refusal moves focus to what the person must act on, so a screen reader announces it.
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
          title="Check your email"
          body={signInSentBody(state.email)}
          action={
            <ButtonLink href={signInHref(next)} variant="secondary">
              Use a different email
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const email = state.status === 'idle' ? '' : state.email;
  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      {state.status === 'rate_limited' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert
            tone="warning"
            title="Too many sign-in links requested"
            body={rateLimitBody(state.retryAfterMinutes)}
          />
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert
            tone="danger"
            title="We could not send a link"
            body="Something went wrong on our side. Please try again in a moment."
          />
        </div>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <Input
        name="email"
        type="email"
        label="Email"
        hint="We email you a link that signs you in. No password."
        autoComplete="email"
        defaultValue={email}
        {...(state.status === 'invalid'
          ? { errorText: 'Enter an email address, like name@example.com.' }
          : {})}
        maxLength={254}
        required
      />
      <Button type="submit" size="lg" loading={pending}>
        Email me a link
      </Button>
    </form>
  );
}
