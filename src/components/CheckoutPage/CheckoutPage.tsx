'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { FakePaymentForm } from '@/components/FakePaymentForm';
import { Header } from '@/components/Header';
import { OrderSummary } from '@/components/OrderSummary';
import {
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import {
  firstErrorField,
  focusId,
  formIssues,
  issueCount,
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
import type { CheckoutView } from '@/lib/pages/checkoutPage';
import type { FakeConfirmResult } from '@/lib/fakePayment';
import type { FakeConfirmInput } from '@/lib/fakePaymentInput';
import { experiencePath, orderConfirmationPath } from '@/lib/routes';
import styles from './CheckoutPage.module.css';
import { CheckoutForm } from './CheckoutForm';
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

  /** After the errors render, so the field that was wrong has its error text to announce. */
  function focusFirstInvalid(errors: Record<string, string>) {
    const first = firstErrorField(errors);
    if (first) {
      requestAnimationFrame(() => {
        document.getElementById(focusId(first))?.focus();
      });
    }
  }

  async function submit(values: FormValues) {
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

  const errors = step.step === 'details' ? step.errors : {};
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
                <CheckoutForm
                  view={view}
                  errors={errors}
                  sending={sending}
                  notice={step.step === 'details' ? step.notice : null}
                  onSubmit={(values) => void submit(values)}
                />
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
