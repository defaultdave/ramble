// The vocabulary shared by the fake card form, its flow, and the server entry that confirms a
// payment. Pure, so the browser and the server read the same rules.

/** Why a try failed, as the fake gateway reports it (the adapter accepts any `[a-z0-9_]{1,64}`). */
export const declineCodes = [
  'card_declined',
  'insufficient_funds',
  'expired_card',
  'incorrect_cvc',
  'authentication_failed',
] as const;
export type DeclineCode = (typeof declineCodes)[number];

export const fakeWallets = ['apple_pay', 'google_pay'] as const;
export type FakeWallet = (typeof fakeWallets)[number];

export const walletLabels = {
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
} satisfies Record<FakeWallet, string>;

/** What the guest's step asks the fake gateway to record. */
export type FakeConfirmPlan =
  | { outcome: 'succeeded'; method: 'card' | FakeWallet }
  | { outcome: 'declined'; failureCode: DeclineCode }
  | { outcome: 'requires_action' };

/**
 * The gateway's answer. `refused` covers an unknown payment, a wrong client secret, and a
 * payment that cannot take another try alike, so nobody can tell which it was.
 */
export type FakeConfirmResult =
  | { status: 'succeeded' }
  | { status: 'declined'; failureCode: DeclineCode }
  | { status: 'requires_action' }
  | { status: 'refused' };

/** The guest finished or failed the 3-D Secure step. */
export function planChallenge(passed: boolean): FakeConfirmPlan {
  return passed
    ? { outcome: 'succeeded', method: 'card' }
    : { outcome: 'declined', failureCode: 'authentication_failed' };
}

/** The guest approved the demo wallet sheet. */
export function planWallet(wallet: FakeWallet): FakeConfirmPlan {
  return { outcome: 'succeeded', method: wallet };
}

/** A payments error the guest can do nothing about; any other error is rethrown so the form treats the answer as lost. */
export function isRefusalCode(code: string): boolean {
  return code === 'not_found' || code === 'invalid_state';
}

type NoticeTone = 'danger' | 'warning' | 'info';
export type NoticeCopy = { tone: NoticeTone; title: string; body: string };

const declineCopy = {
  card_declined: {
    title: 'Your card was declined',
    body: "Your bank didn't approve this payment. Your spaces are still held. Try another card or a wallet.",
  },
  insufficient_funds: {
    title: 'Your card has insufficient funds',
    body: "Your bank couldn't cover this payment. Your spaces are still held. Try another card or a wallet.",
  },
  expired_card: {
    title: 'Your card has expired',
    body: 'Check the expiry date, or try another card or a wallet. Your spaces are still held.',
  },
  incorrect_cvc: {
    title: "The security code didn't match",
    body: 'Check the 3 digits on your card and try again. Your spaces are still held.',
  },
  authentication_failed: {
    title: "We couldn't verify it's you",
    body: "Your bank didn't complete the check and nothing was charged. Your spaces are still held. Try again or use another card.",
  },
} satisfies Record<DeclineCode, Omit<NoticeCopy, 'tone'>>;

/** Safe copy for a failed try: a code the form does not know reads as a plain decline. */
export function declineNotice(failureCode: string): NoticeCopy {
  const known = declineCopy[failureCode as DeclineCode] as
    Omit<NoticeCopy, 'tone'> | undefined;
  return { tone: 'danger', ...(known ?? declineCopy.card_declined) };
}

export const refusedNotice: NoticeCopy = {
  tone: 'danger',
  title: "We couldn't take this payment",
  body: 'This payment is no longer open. Reload the page to see where your order stands.',
};

export function walletCancelledNotice(wallet: FakeWallet): NoticeCopy {
  return {
    tone: 'info',
    title: `${walletLabels[wallet]} was cancelled`,
    body: 'Nothing was charged. Choose a payment method to try again.',
  };
}

export const connectionLostNotice: NoticeCopy = {
  tone: 'warning',
  title: "We're checking your payment",
  body: "Your connection dropped after you tapped Pay. Please don't pay again. We'll show your booking here as soon as it's confirmed, and email you either way.",
};
