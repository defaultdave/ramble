'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { FakePaymentForm } from '@/components/FakePaymentForm';
import { Header } from '@/components/Header';
import { Input } from '@/components/Input';
import { OrderSummary } from '@/components/OrderSummary';
import {
  ageRequirements,
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import {
  childAgeKeys,
  errorMessage,
  firstErrorField,
  focusId,
  formIssues,
  guardianKeys,
  initialValues,
  inputId,
  issueCount,
  issueSummary,
  startPaymentInput,
  type FormValues,
} from '@/lib/pages/checkoutForm';
import {
  alternativeRow,
  canSend,
  checkoutReducer,
  destination,
  expiredCopy,
  initialStep,
  maintenanceCopy,
  reholdRequest,
  soldOutCopy,
  tooManyTriesCopy,
  type CheckoutStep,
  type ReholdInput,
  type ReholdResult,
} from '@/lib/pages/checkoutFlow';
import { ageRangeHint, type CheckoutView } from '@/lib/pages/checkoutPage';
import type { FakeConfirmResult } from '@/lib/fakePayment';
import type { FakeConfirmInput } from '@/lib/fakePaymentInput';
import { formatMoney } from '@/lib/money';
import { experiencePath, orderConfirmationPath } from '@/lib/routes';
import styles from './CheckoutPage.module.css';
import { CheckoutHoldTimer } from './CheckoutHoldTimer';

export type CheckoutActions = {
  startPayment: (input: StartPaymentInput) => Promise<StartPaymentResult>;
  confirm: (input: FakeConfirmInput) => Promise<FakeConfirmResult>;
  reserve: (input: ReholdInput) => Promise<ReholdResult>;
};

export type CheckoutPageProps = {
  view: CheckoutView;
  actions: CheckoutActions;
  /** The ops switch (ADR 0002): checkout shows a notice and takes no payment. */
  maintenance?: boolean;
  /** Set when the guest arrives from holding their spaces again: focus goes to the heading. */
  focusTitle?: boolean;
};

/** An error prop only when there is an error: the inputs take no explicit `undefined`. */
function optionalError(text: string | undefined) {
  return text === undefined ? {} : { errorText: text };
}

/**
 * The checkout page's one client island: the form state, the hold timer, and the payment form.
 * `startPayment` is called only from the guest's tap on Continue, never on load or refresh, so
 * reloading the page spends none of the hold's five tries.
 */
export function CheckoutPage({
  view,
  actions,
  maintenance = false,
  focusTitle = false,
}: CheckoutPageProps) {
  const router = useRouter();
  const [step, dispatch] = useReducer(checkoutReducer, initialStep);
  const [values, setValues] = useState(() => initialValues(view));
  // Collapsed on a phone; from 768px the summary opens by itself (`openFrom`).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // The panel that replaces the form (payment, ended, sold out): focus moves to it when it shows.
  const stepRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step.step !== 'details') stepRef.current?.focus();
  }, [step.step]);

  // A new hold is a new page, which loads with focus on the body.
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  const needs = ageRequirements(view.ageSubject, view.children);
  const childAges = needs.childAges;

  /** After the errors render, so the field that was wrong has its error text to announce. */
  function focusFirstInvalid(errors: Record<string, string>) {
    const first = firstErrorField(errors);
    if (first) {
      requestAnimationFrame(() => {
        document.getElementById(focusId(first))?.focus();
      });
    }
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend(step)) return;
    const found = formIssues(values, view);
    if (issueCount(found) > 0) {
      dispatch({ type: 'errors', errors: found });
      focusFirstInvalid(found);
      return;
    }
    dispatch({ type: 'sending' });
    let result: StartPaymentResult;
    try {
      result = await actions.startPayment(startPaymentInput(values, view));
    } catch {
      dispatch({ type: 'request_failed' });
      return;
    }
    const next = destination(result);
    if (next !== null) {
      router.push(next);
      return;
    }
    dispatch({ type: 'answered', result });
    if (result.status === 'invalid') focusFirstInvalid(result.fieldErrors);
  }

  async function holdAgain() {
    dispatch({ type: 'reholding' });
    let result: ReholdResult;
    try {
      result = await actions.reserve(reholdRequest(view));
    } catch {
      dispatch({ type: 'rehold_answered', result: { status: 'unreachable' } });
      return;
    }
    const next = destination(result);
    if (next !== null) {
      router.push(next);
      return;
    }
    dispatch({ type: 'rehold_answered', result });
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const text =
    (
      key:
        | 'email'
        | 'phone'
        | 'leadGuestName'
        | 'guardianName'
        | 'guardianContact',
    ) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      set(key, event.target.value);
    };
  const ticked =
    (key: 'newsletter' | 'ageConfirmed' | 'waiverAccepted' | 'termsAccepted') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      set(key, event.target.checked);
    };

  const errors = step.step === 'details' ? step.errors : {};
  const message = (...keys: string[]) => errorMessage(errors, ...keys);
  const sending = step.step === 'details' && step.sending;

  return (
    <>
      <Header
        variant="checkout"
        holdTimer={
          <CheckoutHoldTimer
            expiresAt={view.expiresAt}
            serverNow={view.serverNow}
            onEnd={() => {
              dispatch({ type: 'timer_ended' });
            }}
          />
        }
      />
      <main id="main" className={styles.main}>
        <div className={styles.page}>
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            Checkout
          </h1>
          <div className={styles.summary}>
            <OrderSummary
              title={view.experience.title}
              dateLabel={view.dateLabel}
              timeLabel={view.timeLabel}
              guests={view.guests}
              where={view.where}
              lines={view.lines}
              taxTreatment={view.taxTreatment}
              taxMinor={view.taxMinor}
              totalMinor={view.totalMinor}
              terms={view.cancellationLine}
              openFrom="tablet"
              expanded={summaryOpen}
              onToggle={() => {
                setSummaryOpen(!summaryOpen);
              }}
            />
          </div>
          <div className={styles.flow}>
            {maintenance ? (
              <Alert
                tone="warning"
                title={maintenanceCopy.title}
                body={maintenanceCopy.body}
              />
            ) : (
              <Step
                step={step}
                view={view}
                actions={actions}
                focusRef={stepRef}
                holdAgain={() => void holdAgain()}
                onPaid={(reference, token) => {
                  router.push(orderConfirmationPath(reference, token));
                }}
                onLost={() => {
                  dispatch({ type: 'connection_lost' });
                }}
              >
                <form
                  className={styles.form}
                  noValidate
                  onSubmit={(event) => void submit(event)}
                >
                  <p role="status" className={styles.visuallyHidden}>
                    {sending ? 'Getting your payment ready' : ''}
                  </p>
                  {step.step === 'details' && step.notice ? (
                    <Alert tone="danger" title="Not sent" body={step.notice} />
                  ) : null}

                  <fieldset className={styles.group}>
                    <legend className={styles.legend}>Contact</legend>
                    <Input
                      id={inputId('contact.email')}
                      label="Email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={254}
                      hint="Your confirmation and any updates go here."
                      value={values.email}
                      {...optionalError(message('contact.email'))}
                      onChange={text('email')}
                    />
                    <Input
                      id={inputId('contact.phone')}
                      label="Phone"
                      optional
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={40}
                      hint="Only for day-of changes from the host."
                      value={values.phone}
                      {...optionalError(message('contact.phone'))}
                      onChange={text('phone')}
                    />
                    <Checkbox
                      label="Send me the Ramble newsletter"
                      description="One email on Sundays. Leave any time."
                      checked={values.newsletter}
                      onChange={ticked('newsletter')}
                    />
                  </fieldset>

                  <fieldset className={styles.group}>
                    <legend className={styles.legend}>Who&apos;s coming</legend>
                    <Input
                      id={inputId('leadGuestName')}
                      label="Lead guest name"
                      autoComplete="name"
                      maxLength={120}
                      value={values.leadGuestName}
                      {...optionalError(message('leadGuestName'))}
                      onChange={text('leadGuestName')}
                    />
                    {needs.confirmation === null ? null : (
                      <Acceptance
                        id={inputId('attendees.ageConfirmed')}
                        label={needs.confirmation}
                        checked={values.ageConfirmed}
                        error={message('attendees.ageConfirmed')}
                        onChange={ticked('ageConfirmed')}
                      />
                    )}
                    {childAges === null ? null : (
                      <>
                        <div className={styles.ages}>
                          {values.childAges.map((age, index) => (
                            <Input
                              // The ages are positional, one box per child, so the index is their identity.
                              key={index}
                              id={inputId(
                                `attendees.childrenAges.${String(index)}`,
                              )}
                              label={`Child ${String(index + 1)} age`}
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={2}
                              {...(index === 0
                                ? { hint: ageRangeHint(childAges) }
                                : {})}
                              value={age}
                              {...optionalError(
                                message(...childAgeKeys(index)),
                              )}
                              onChange={(event) => {
                                set(
                                  'childAges',
                                  values.childAges.map((existing, at) =>
                                    at === index
                                      ? event.target.value
                                      : existing,
                                  ),
                                );
                              }}
                            />
                          ))}
                        </div>
                        <Input
                          id={inputId('attendees.guardian.name')}
                          label="Guardian name"
                          autoComplete="off"
                          maxLength={120}
                          value={values.guardianName}
                          {...optionalError(message(...guardianKeys.name))}
                          onChange={text('guardianName')}
                        />
                        <Input
                          id={inputId('attendees.guardian.contact')}
                          label="Guardian phone or email"
                          autoComplete="off"
                          maxLength={254}
                          hint="The adult who comes with the children."
                          value={values.guardianContact}
                          {...optionalError(message(...guardianKeys.contact))}
                          onChange={text('guardianContact')}
                        />
                      </>
                    )}
                  </fieldset>

                  {view.waiverDocument === null ? null : (
                    <fieldset className={styles.group}>
                      <legend className={styles.legend}>Host waiver</legend>
                      <p className={styles.body}>
                        {view.experience.hostName} asks every guest to accept
                        its waiver.
                      </p>
                      <DocumentLink href={view.waiverDocument.href}>
                        Read the waiver
                      </DocumentLink>
                      <Acceptance
                        id={inputId('waiverDocumentId')}
                        label="I accept the waiver for everyone in my party"
                        checked={values.waiverAccepted}
                        error={message('waiverDocumentId')}
                        onChange={ticked('waiverAccepted')}
                      />
                    </fieldset>
                  )}

                  <fieldset className={styles.group}>
                    <legend className={styles.legend}>Terms</legend>
                    <DocumentLink href={view.termsDocument.href}>
                      Read the terms
                    </DocumentLink>
                    <Acceptance
                      id={inputId('termsDocumentId')}
                      label="I accept Ramble's terms and the cancellation terms below"
                      checked={values.termsAccepted}
                      error={message('termsDocumentId')}
                      onChange={ticked('termsAccepted')}
                    />
                  </fieldset>

                  <div className={styles.total}>
                    <div className={styles.totalRow}>
                      <span>Total charged</span>
                      <span className={styles.totalAmount}>
                        {formatMoney(view.totalMinor)}
                      </span>
                    </div>
                    <p className={styles.caption}>{view.cancellationLine}</p>
                  </div>

                  {issueCount(errors) > 0 ? (
                    <Alert
                      tone="danger"
                      title="Check your details"
                      body={issueSummary(issueCount(errors))}
                    />
                  ) : null}

                  <div className={styles.actions}>
                    <Button type="submit" size="lg" loading={sending}>
                      {sending
                        ? 'Getting payment ready'
                        : 'Continue to payment'}
                    </Button>
                    <p className={styles.caption}>
                      You choose a card or wallet on the next step. Nothing is
                      charged until then.
                    </p>
                  </div>
                </form>
              </Step>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

type StepProps = {
  step: CheckoutStep;
  view: CheckoutView;
  actions: CheckoutActions;
  holdAgain: () => void;
  onPaid: (reference: string, orderToken: string | undefined) => void;
  onLost: () => void;
  /** The panel's root, which takes focus when it replaces the form. */
  focusRef: RefObject<HTMLDivElement | null>;
  /** The details form, shown while the guest is still filling it in. */
  children: ReactNode;
};

function Step({
  step,
  view,
  actions,
  holdAgain,
  onPaid,
  onLost,
  focusRef,
  children,
}: StepProps) {
  switch (step.step) {
    case 'details':
      return children;
    case 'payment':
      return (
        <div
          ref={focusRef}
          tabIndex={-1}
          role="group"
          aria-label="Payment"
          className={styles.payment}
        >
          {step.lost ? (
            <ButtonLink
              href={orderConfirmationPath(step.reference, step.orderToken)}
              variant="ghost"
            >
              Check again
            </ButtonLink>
          ) : null}
          <FakePaymentForm
            payment={step.payment}
            amountMinor={step.amountDueMinor}
            confirm={actions.confirm}
            onSucceeded={() => {
              onPaid(step.reference, step.orderToken);
            }}
            onConnectionLost={onLost}
          />
        </div>
      );
    case 'expired': {
      const copy = expiredCopy(view, step, view.holdMinutes);
      return (
        <div ref={focusRef} tabIndex={-1} className={styles.state}>
          <Alert tone="danger" title={copy.title} body={copy.body} />
          {step.notice ? (
            <Alert tone="warning" title="Not held" body={step.notice} />
          ) : null}
          {copy.canRehold ? (
            <Button size="lg" loading={step.reholding} onClick={holdAgain}>
              Hold my spaces again
            </Button>
          ) : (
            <ButtonLink href={experiencePath(view.experience)}>
              Choose another date
            </ButtonLink>
          )}
        </div>
      );
    }
    case 'sold_out': {
      const copy = soldOutCopy(view);
      return (
        <div ref={focusRef} tabIndex={-1} className={styles.state}>
          <Alert tone="danger" title={copy.title} body={copy.body} />
          {step.alternatives.length > 0 ? (
            <section aria-labelledby="alternatives-heading">
              <h2 id="alternatives-heading" className={styles.legend}>
                {copy.heading}
              </h2>
              <ul className={styles.alternatives}>
                {step.alternatives.map((alternative) => {
                  const row = alternativeRow(view, alternative);
                  return (
                    <li key={row.key}>
                      <Link href={row.href} className={styles.alternative}>
                        <span>
                          <span className={styles.alternativeLabel}>
                            {row.label}
                          </span>
                          <span
                            className={styles.alternativeNote}
                            data-tone={row.tone}
                          >
                            {row.note}
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <ButtonLink
            href={experiencePath(view.experience)}
            variant="secondary"
          >
            See all dates
          </ButtonLink>
        </div>
      );
    }
    case 'too_many_tries':
      return (
        <div ref={focusRef} tabIndex={-1} className={styles.state}>
          <Alert
            tone="danger"
            title={tooManyTriesCopy.title}
            body={tooManyTriesCopy.body}
          />
          <ButtonLink
            href={experiencePath(view.experience)}
            variant="secondary"
          >
            Back to the experience
          </ButtonLink>
        </div>
      );
  }
}

function Acceptance({
  id,
  label,
  checked,
  error,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  error: string | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <Checkbox
        id={id}
        label={label}
        checked={checked}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DocumentLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  // A new tab, so the guest keeps what they typed.
  return (
    <a
      className={styles.documentLink}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <span className={styles.visuallyHidden}> (opens in a new tab)</span>
    </a>
  );
}
