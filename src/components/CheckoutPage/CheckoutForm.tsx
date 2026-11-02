import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { ExternalLink } from '@/components/ExternalLink';
import { Input, type InputProps } from '@/components/Input';
import { ageRequirements } from '@/lib/checkout';
import {
  childAgeKeys,
  errorMessage,
  guardianKeys,
  initialValues,
  inputId,
  issueCount,
  issueSummary,
  type FormValues,
} from '@/lib/pages/checkoutForm';
import { ageRangeHint, type CheckoutView } from '@/lib/pages/checkoutPage';
import { formatMoney } from '@/lib/money';
import styles from './CheckoutPage.module.css';

type TextKey =
  'email' | 'phone' | 'leadGuestName' | 'guardianName' | 'guardianContact';
type TickKey =
  'newsletter' | 'ageConfirmed' | 'waiverAccepted' | 'termsAccepted';

export type CheckoutFormProps = {
  view: CheckoutView;
  /** The messages from the last check, by field key. */
  errors: Record<string, string>;
  sending: boolean;
  /** Why the last send failed, when it did. */
  notice: string | null;
  /** Called with the typed values when the guest taps Continue; the page checks and sends them. */
  onSubmit: (values: FormValues) => void;
};

/** An error prop only when there is an error: the inputs take no explicit `undefined`. */
function optionalError(text: string | undefined) {
  return text === undefined ? {} : { errorText: text };
}

/** A text field's name, or a child's position for the age boxes. */
type FieldKey = TextKey | number;

type FieldProps = Omit<InputProps, 'onChange' | 'errorText' | 'value'> & {
  field: FieldKey;
  value: string;
  errorText: string | undefined;
  onValue: (field: FieldKey, value: string) => void;
};

/** One text box. It is memoised on plain values and the form's stable handler, so only the box typed in renders. */
const Field = memo(function Field({
  field,
  errorText,
  onValue,
  ...rest
}: FieldProps) {
  return (
    <Input
      {...rest}
      {...optionalError(errorText)}
      onChange={(event) => {
        onValue(field, event.target.value);
      }}
    />
  );
});

type NewsletterProps = {
  checked: boolean;
  onTick: (field: TickKey, checked: boolean) => void;
};

const Newsletter = memo(function Newsletter({
  checked,
  onTick,
}: NewsletterProps) {
  return (
    <Checkbox
      label="Send me the Ramble newsletter"
      description="One email on Sundays. Leave any time."
      checked={checked}
      onChange={(event) => {
        onTick('newsletter', event.target.checked);
      }}
    />
  );
});

type AcceptanceProps = {
  id: string;
  field: TickKey;
  label: string;
  checked: boolean;
  error: string | undefined;
  onTick: (field: TickKey, checked: boolean) => void;
};

const Acceptance = memo(function Acceptance({
  id,
  field,
  label,
  checked,
  error,
  onTick,
}: AcceptanceProps) {
  const errorId = `${id}-error`;
  return (
    <div>
      <Checkbox
        id={id}
        label={label}
        checked={checked}
        onChange={(event) => {
          onTick(field, event.target.checked);
        }}
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
});

function DocumentLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  // A new tab, so the guest keeps what they typed.
  return (
    <ExternalLink className={styles.documentLink} href={href}>
      {children}
    </ExternalLink>
  );
}

/**
 * The details form. It owns what the guest has typed, so a keystroke re-renders this form and the
 * one field typed in, not the page around it. The handlers it gives the fields never change.
 */
export function CheckoutForm({
  view,
  errors,
  sending,
  notice,
  onSubmit,
}: CheckoutFormProps) {
  const [values, setValues] = useState(() => initialValues(view));
  const needs = useMemo(
    () => ageRequirements(view.ageSubject, view.children),
    [view.ageSubject, view.children],
  );
  const childAges = needs.childAges;

  const onValue = useCallback((field: FieldKey, value: string) => {
    setValues((current) =>
      typeof field === 'number'
        ? {
            ...current,
            childAges: current.childAges.map((existing, at) =>
              at === field ? value : existing,
            ),
          }
        : { ...current, [field]: value },
    );
  }, []);
  const onTick = useCallback((field: TickKey, checked: boolean) => {
    setValues((current) => ({ ...current, [field]: checked }));
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  // Focus stays on Continue after a failed send, so the notice takes it and is read out.
  useEffect(() => {
    if (notice) {
      formRef.current
        ?.querySelector<HTMLElement>('[data-checkout-notice]')
        ?.focus();
    }
  }, [notice]);

  const message = (...keys: string[]) => errorMessage(errors, ...keys);

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <p role="status" className={styles.visuallyHidden}>
        {sending ? 'Getting your payment ready' : ''}
      </p>
      {notice ? (
        <Alert
          data-checkout-notice=""
          tabIndex={-1}
          tone="danger"
          title="Not sent"
          body={notice}
        />
      ) : null}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Contact</legend>
        <Field
          field="email"
          id={inputId('contact.email')}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          hint="Your confirmation and any updates go here."
          value={values.email}
          errorText={message('contact.email')}
          onValue={onValue}
        />
        <Field
          field="phone"
          id={inputId('contact.phone')}
          label="Phone"
          optional
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          hint="Only for day-of changes from the host."
          value={values.phone}
          errorText={message('contact.phone')}
          onValue={onValue}
        />
        <Newsletter checked={values.newsletter} onTick={onTick} />
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Who&apos;s coming</legend>
        <Field
          field="leadGuestName"
          id={inputId('leadGuestName')}
          label="Lead guest name"
          autoComplete="name"
          maxLength={120}
          value={values.leadGuestName}
          errorText={message('leadGuestName')}
          onValue={onValue}
        />
        {needs.confirmation === null ? null : (
          <Acceptance
            id={inputId('attendees.ageConfirmed')}
            field="ageConfirmed"
            label={needs.confirmation}
            checked={values.ageConfirmed}
            error={message('attendees.ageConfirmed')}
            onTick={onTick}
          />
        )}
        {childAges === null ? null : (
          <>
            <div className={styles.ages}>
              {values.childAges.map((age, index) => (
                <Field
                  // The ages are positional, one box per child, so the index is their identity.
                  key={index}
                  field={index}
                  id={inputId(`attendees.childrenAges.${String(index)}`)}
                  label={`Child ${String(index + 1)} age`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  {...(index === 0 ? { hint: ageRangeHint(childAges) } : {})}
                  value={age}
                  errorText={message(...childAgeKeys(index))}
                  onValue={onValue}
                />
              ))}
            </div>
            <Field
              field="guardianName"
              id={inputId('attendees.guardian.name')}
              label="Guardian name"
              autoComplete="off"
              maxLength={120}
              value={values.guardianName}
              errorText={message(...guardianKeys.name)}
              onValue={onValue}
            />
            <Field
              field="guardianContact"
              id={inputId('attendees.guardian.contact')}
              label="Guardian phone or email"
              autoComplete="off"
              maxLength={254}
              hint="The adult who comes with the children."
              value={values.guardianContact}
              errorText={message(...guardianKeys.contact)}
              onValue={onValue}
            />
          </>
        )}
      </fieldset>

      {view.waiverDocument === null ? null : (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Host waiver</legend>
          <p className={styles.body}>
            {view.experience.hostName} asks every guest to accept its waiver.
          </p>
          <DocumentLink href={view.waiverDocument.href}>
            Read the waiver
          </DocumentLink>
          <Acceptance
            id={inputId('waiverDocumentId')}
            field="waiverAccepted"
            label="I accept the waiver for everyone in my party"
            checked={values.waiverAccepted}
            error={message('waiverDocumentId')}
            onTick={onTick}
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
          field="termsAccepted"
          label="I accept Ramble's terms and the cancellation terms below"
          checked={values.termsAccepted}
          error={message('termsDocumentId')}
          onTick={onTick}
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
          {sending ? 'Getting payment ready' : 'Continue to payment'}
        </Button>
        <p className={styles.caption}>
          You choose a card or wallet on the next step. Nothing is charged until
          then.
        </p>
      </div>
    </form>
  );
}
