'use client';

import { TriangleAlert } from 'lucide-react';
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import {
  cardNumberDigits,
  cardOutcome,
  cvcDigits,
  firstErrorField,
  visibleErrors,
  formatCardField,
  planCard,
  testCards,
  validateCard,
  zipDigits,
  type CardErrors,
  type CardField,
  type CardFields,
} from '@/lib/fakeCard';
import {
  fakeWallets,
  planChallenge,
  planWallet,
  walletLabels,
  type FakeConfirmPlan,
  type FakeConfirmResult,
  type FakeWallet,
} from '@/lib/fakePayment';
import {
  flowNotice,
  flowReducer,
  focusTarget,
  initialFlow,
  onSheet,
  type ConfirmingFrom,
  type FlowState,
} from '@/lib/fakePaymentFlow';
import type { FakeConfirmInput } from '@/lib/fakePaymentInput';
import { formatMoney } from '@/lib/money';
import styles from './FakePaymentForm.module.css';

export type FakePaymentFormProps = {
  /** The payment the guest is paying: its id and the client secret that lets them confirm it. */
  payment: { id: string; clientSecret: string };
  /** Integer minor units, the amount charged. */
  amountMinor: number;
  /** Sends the guest's step to the fake gateway. A rejection means the answer was lost. */
  confirm: (input: FakeConfirmInput) => Promise<FakeConfirmResult>;
  onSucceeded: () => void;
  onConnectionLost?: () => void;
};

const emptyFields: CardFields = { number: '', expiry: '', cvc: '', zip: '' };

export function FakePaymentForm({
  payment,
  amountMinor,
  confirm,
  onSucceeded,
  onConnectionLost,
}: FakePaymentFormProps) {
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [fields, setFields] = useState<CardFields>(emptyFields);
  const [errors, setErrors] = useState<CardErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  // A second tap lands before the first one has re-rendered the button as disabled.
  const sending = useRef(false);
  const uid = useId();

  const locked = flow.step === 'confirming';
  const view: FlowState | ConfirmingFrom =
    flow.step === 'confirming' ? flow.from : flow;
  const notice = flowNotice(flow);
  const payLabel = `Pay ${formatMoney(amountMinor)}`;

  const noticeRef = useRef<HTMLDivElement>(null);
  const wasOnSheet = useRef(false);

  // Focus follows the step: into a sheet when it opens, and to the notice or Pay when it closes.
  useEffect(() => {
    const target = focusTarget(wasOnSheet.current, flow);
    wasOnSheet.current = onSheet(flow);
    if (target === 'sheet') panelHeadingRef.current?.focus();
    if (target === 'notice') noticeRef.current?.focus();
    if (target === 'pay') {
      formRef.current
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.focus();
    }
  }, [flow]);

  async function send(plan: FakeConfirmPlan) {
    if (sending.current) return;
    sending.current = true;
    dispatch({ type: 'submitted' });
    let result: FakeConfirmResult;
    try {
      result = await confirm({
        paymentId: payment.id,
        clientSecret: payment.clientSecret,
        plan,
      });
    } catch {
      dispatch({ type: 'connection_lost' });
      onConnectionLost?.();
      return;
    } finally {
      sending.current = false;
    }
    dispatch({ type: 'confirmed', result });
    if (result.status === 'succeeded') onSucceeded();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const found = validateCard(fields, new Date());
    setErrors(found);
    const first = firstErrorField(found);
    if (first) {
      formRef.current
        ?.querySelector<HTMLInputElement>(`[name="${first}"]`)
        ?.focus();
      return;
    }
    const outcome = cardOutcome(fields.number);
    if (outcome) void send(planCard(outcome));
  }

  function onField(field: CardField) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = formatCardField(field, event.target.value);
      setFields((current) => ({ ...current, [field]: value }));
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  function openWallet(wallet: FakeWallet) {
    dispatch({ type: 'wallet_opened', wallet });
  }

  if (flow.step === 'succeeded') {
    return (
      <div className={styles.form}>
        <Alert
          tone="success"
          title="Payment received"
          body="Taking you to your booking."
        />
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <Alert
        tone="info"
        title="Demo payment form"
        body="No real payment is taken here, and no real card is accepted. Only the test cards listed below work."
      />
      <p role="status" className={styles.visuallyHidden}>
        {locked ? 'Confirming payment' : ''}
      </p>
      {notice ? (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Alert tone={notice.tone} title={notice.title} body={notice.body} />
        </div>
      ) : null}

      {view.step === 'entering' ? (
        <>
          <section className={styles.section} aria-label="Pay with a wallet">
            <div className={styles.wallets}>
              {fakeWallets.map((wallet) => (
                <button
                  key={wallet}
                  type="button"
                  className={styles.wallet}
                  disabled={locked}
                  onClick={() => {
                    openWallet(wallet);
                  }}
                >
                  {walletLabels[wallet]}
                </button>
              ))}
            </div>
            <p className={styles.caption}>
              Demo wallet buttons. A real checkout shows them only where the
              device supports them.
            </p>
          </section>

          <form
            ref={formRef}
            className={styles.section}
            noValidate
            onSubmit={onSubmit}
          >
            <h2 className={styles.heading}>Payment</h2>
            <div className={styles.group}>
              <div className={styles.numberRow}>
                <CardInput
                  field="number"
                  label="Card number"
                  placeholder="Card number"
                  autoComplete="off"
                  value={fields.number}
                  error={errors.number}
                  uid={uid}
                  disabled={locked}
                  onChange={onField('number')}
                />
              </div>
              <div className={styles.details}>
                <CardInput
                  field="expiry"
                  label="Expiry date, month and year"
                  placeholder="MM / YY"
                  autoComplete="off"
                  value={fields.expiry}
                  error={errors.expiry}
                  uid={uid}
                  disabled={locked}
                  onChange={onField('expiry')}
                />
                <CardInput
                  field="cvc"
                  label="Security code"
                  placeholder="CVC"
                  autoComplete="off"
                  value={fields.cvc}
                  error={errors.cvc}
                  uid={uid}
                  disabled={locked}
                  onChange={onField('cvc')}
                />
                <CardInput
                  field="zip"
                  label="ZIP code"
                  placeholder="ZIP"
                  autoComplete="off"
                  value={fields.zip}
                  error={errors.zip}
                  uid={uid}
                  disabled={locked}
                  onChange={onField('zip')}
                />
              </div>
            </div>
            <FieldErrors errors={errors} uid={uid} />
            <p className={styles.caption}>
              Card details stay in this browser. Ramble never sees or stores
              them.
            </p>
            <TestCards />
            <Button type="submit" size="lg" loading={locked}>
              {payLabel}
            </Button>
          </form>
        </>
      ) : null}

      {view.step === 'challenge' ? (
        <section className={styles.sheet} aria-labelledby={`${uid}-sheet`}>
          <h2
            id={`${uid}-sheet`}
            ref={panelHeadingRef}
            tabIndex={-1}
            className={styles.sheetHeading}
          >
            Verify it&apos;s you
          </h2>
          <p className={styles.sheetBody}>
            This is the demo 3-D Secure step. In a real checkout your
            bank&apos;s page opens here and asks you to approve the payment.
            Choose what happens next.
          </p>
          <div className={styles.actions}>
            <Button
              size="lg"
              loading={locked}
              onClick={() => void send(planChallenge(true))}
            >
              Complete verification
            </Button>
            <Button
              variant="secondary"
              size="lg"
              loading={locked}
              onClick={() => void send(planChallenge(false))}
            >
              Fail verification
            </Button>
          </div>
        </section>
      ) : null}

      {view.step === 'wallet' ? (
        <section className={styles.sheet} aria-labelledby={`${uid}-sheet`}>
          <h2
            id={`${uid}-sheet`}
            ref={panelHeadingRef}
            tabIndex={-1}
            className={styles.sheetHeading}
          >
            {walletLabels[view.wallet]} (demo)
          </h2>
          <p className={styles.sheetBody}>
            In a real checkout your device&apos;s wallet sheet opens here.
            Choose what happens next.
          </p>
          <div className={styles.actions}>
            <Button
              size="lg"
              loading={locked}
              onClick={() => void send(planWallet(view.wallet))}
            >
              {payLabel}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={locked}
              onClick={() => {
                dispatch({ type: 'wallet_cancelled' });
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {view.step === 'lost' ? (
        <div className={styles.section}>
          <Button size="lg" loading disabled>
            Confirming payment
          </Button>
          <p className={styles.caption}>
            You&apos;re charged once, even if you tap twice.
          </p>
        </div>
      ) : null}
    </div>
  );
}

type CardInputProps = {
  field: CardField;
  label: string;
  placeholder: string;
  autoComplete: 'off';
  value: string;
  error: string | undefined;
  uid: string;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function CardInput({
  field,
  label,
  placeholder,
  autoComplete,
  value,
  error,
  uid,
  disabled,
  onChange,
}: CardInputProps) {
  return (
    <>
      <label className={styles.visuallyHidden} htmlFor={`${uid}-${field}`}>
        {label}
      </label>
      <input
        id={`${uid}-${field}`}
        name={field}
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-${field}-error` : undefined}
        onChange={onChange}
      />
    </>
  );
}

function FieldErrors({ errors, uid }: { errors: CardErrors; uid: string }) {
  const shown = visibleErrors(errors);
  if (shown.length === 0) return null;
  return (
    <div role="alert" className={styles.errors}>
      {shown.map(({ field, message }) => (
        <p key={field} id={`${uid}-${field}-error`} className={styles.error}>
          <TriangleAlert className={styles.errorIcon} aria-hidden="true" />
          {message}
        </p>
      ))}
    </div>
  );
}

function TestCards() {
  return (
    <details className={styles.testCards}>
      <summary className={styles.testCardsSummary}>Demo test cards</summary>
      <p className={styles.testCardsNote}>
        Type one of these {String(cardNumberDigits)}-digit numbers with any
        future expiry date, any {String(cvcDigits)}-digit code, and any{' '}
        {String(zipDigits)}-digit ZIP.
      </p>
      <table className={styles.testCardsTable}>
        <caption className={styles.visuallyHidden}>Demo test cards</caption>
        <thead>
          <tr>
            <th scope="col">Card number</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          {testCards.map((card) => (
            <tr key={card.number}>
              <td className={styles.testCardNumber}>{card.number}</td>
              <td>{card.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
