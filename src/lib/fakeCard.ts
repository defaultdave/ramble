import type { DeclineCode, FakeConfirmPlan } from '@/lib/fakePayment';

// The fake card form takes no real card. A number is accepted only when it is on the list
// below, and nothing but the outcome it selects ever leaves the browser.

export type CardOutcome =
  | { kind: 'succeeds' }
  | { kind: 'declines'; failureCode: DeclineCode }
  | { kind: 'challenges' };

type TestCard = { digits: string; label: string; outcome: CardOutcome };

const testCardTable = [
  {
    digits: '4242424242424242',
    label: 'Payment succeeds',
    outcome: { kind: 'succeeds' },
  },
  {
    digits: '4000000000000002',
    label: 'Declined',
    outcome: { kind: 'declines', failureCode: 'card_declined' },
  },
  {
    digits: '4000000000009995',
    label: 'Declined, insufficient funds',
    outcome: { kind: 'declines', failureCode: 'insufficient_funds' },
  },
  {
    digits: '4000000000000069',
    label: 'Declined, expired card',
    outcome: { kind: 'declines', failureCode: 'expired_card' },
  },
  {
    digits: '4000000000000127',
    label: 'Declined, wrong security code',
    outcome: { kind: 'declines', failureCode: 'incorrect_cvc' },
  },
  {
    digits: '4000000000003220',
    label: '3-D Secure check, which you pass or fail',
    outcome: { kind: 'challenges' },
  },
] as const satisfies readonly TestCard[];

export const cardNumberDigits = 16;
export const cvcDigits = 3;
export const zipDigits = 5;
const expiryDigits = 4;
/** Longest raw text a field reads, so a pasted wall of text costs nothing. */
const maxRawLength = 64;

export function digitsOnly(value: string, max: number): string {
  return value.slice(0, maxRawLength).replace(/\D/g, '').slice(0, max);
}

/** "4242 4242 4242 4242": groups of four, as typed. */
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value, cardNumberDigits);
  const groups: string[] = [];
  for (let start = 0; start < digits.length; start += 4) {
    groups.push(digits.slice(start, start + 4));
  }
  return groups.join(' ');
}

/** "12 / 28". The slash waits for the third digit, so Backspace never fights it. */
export function formatExpiry(value: string): string {
  const digits = digitsOnly(value, expiryDigits);
  return digits.length < 3
    ? digits
    : `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

/** A field's text as it should read after a keystroke or a paste. */
export function formatCardField(field: CardField, value: string): string {
  switch (field) {
    case 'number':
      return formatCardNumber(value);
    case 'expiry':
      return formatExpiry(value);
    case 'cvc':
      return digitsOnly(value, cvcDigits);
    case 'zip':
      return digitsOnly(value, zipDigits);
  }
}

/** Test cards for the guest to try: the number as typed, and what it does. */
export const testCards: readonly { number: string; label: string }[] =
  testCardTable.map((card) => ({
    number: formatCardNumber(card.digits),
    label: card.label,
  }));

/** What a number does, or null when it is not a test card. */
export function cardOutcome(value: string): CardOutcome | null {
  const digits = digitsOnly(value, cardNumberDigits);
  const match = testCardTable.find((card) => card.digits === digits);
  return match ? match.outcome : null;
}

export function planCard(outcome: CardOutcome): FakeConfirmPlan {
  switch (outcome.kind) {
    case 'succeeds':
      return { outcome: 'succeeded', method: 'card' };
    case 'declines':
      return { outcome: 'declined', failureCode: outcome.failureCode };
    case 'challenges':
      return { outcome: 'requires_action' };
  }
}

export type CardFields = {
  number: string;
  expiry: string;
  cvc: string;
  zip: string;
};
export type CardField = keyof CardFields;
export type CardErrors = Partial<Record<CardField, string>>;

/** The order the fields sit in, which is the order focus moves to the first error. */
const cardFieldOrder = [
  'number',
  'expiry',
  'cvc',
  'zip',
] as const satisfies readonly CardField[];

function expiryError(value: string, now: Date): string | undefined {
  const digits = digitsOnly(value, expiryDigits);
  if (digits.length === 0) return 'Enter the expiry date.';
  if (digits.length < expiryDigits) return 'Enter the expiry as MM / YY.';
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2));
  if (month < 1 || month > 12) return 'Enter the expiry as MM / YY.';
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return year * 12 + (month - 1) < current
    ? 'This card has expired. Try a different expiry date.'
    : undefined;
}

function numberError(value: string): string | undefined {
  const digits = digitsOnly(value, cardNumberDigits);
  if (digits.length === 0) return 'Enter a card number.';
  if (digits.length < cardNumberDigits) {
    return `Enter all ${String(cardNumberDigits)} digits of a test card.`;
  }
  return cardOutcome(digits)
    ? undefined
    : 'This demo takes only its test cards. Use one from the list below.';
}

/** Field errors for the card as typed; an empty object means it can be sent. `now` is for the expiry. */
export function validateCard(fields: CardFields, now: Date): CardErrors {
  const errors: CardErrors = {};
  const number = numberError(fields.number);
  if (number) errors.number = number;
  const expiry = expiryError(fields.expiry, now);
  if (expiry) errors.expiry = expiry;
  if (digitsOnly(fields.cvc, cvcDigits).length < cvcDigits) {
    errors.cvc = `Enter the ${String(cvcDigits)}-digit security code.`;
  }
  if (digitsOnly(fields.zip, zipDigits).length < zipDigits) {
    errors.zip = `Enter a ${String(zipDigits)}-digit ZIP code.`;
  }
  return errors;
}

/** The errors to show, in the order the fields sit on the form. */
export function visibleErrors(
  errors: CardErrors,
): { field: CardField; message: string }[] {
  return cardFieldOrder.flatMap((field) => {
    const message = errors[field];
    return message === undefined ? [] : [{ field, message }];
  });
}

/** The first field with an error, in the order they sit on the form. */
export function firstErrorField(errors: CardErrors): CardField | null {
  return visibleErrors(errors)[0]?.field ?? null;
}
