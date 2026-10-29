import { describe, expect, it } from 'vitest';
import {
  connectionLostNotice,
  declineCodes,
  declineNotice,
  isRefusalCode,
  planChallenge,
  planWallet,
  refusedNotice,
  walletCancelledNotice,
} from './fakePayment';

describe('planChallenge', () => {
  it('pays when the guest completes 3-D Secure', () => {
    expect(planChallenge(true)).toEqual({
      outcome: 'succeeded',
      method: 'card',
    });
  });

  it('declines with an authentication failure when the guest fails it', () => {
    expect(planChallenge(false)).toEqual({
      outcome: 'declined',
      failureCode: 'authentication_failed',
    });
  });
});

describe('planWallet', () => {
  it.each(['apple_pay', 'google_pay'] as const)('pays with %s', (wallet) => {
    expect(planWallet(wallet)).toEqual({
      outcome: 'succeeded',
      method: wallet,
    });
  });
});

describe('isRefusalCode', () => {
  it.each([
    ['not_found', true],
    ['invalid_state', true],
    ['provider_unavailable', false],
    ['invalid_input', false],
    ['idempotency_conflict', false],
  ])('%s is %s', (code, expected) => {
    expect(isRefusalCode(code)).toBe(expected);
  });
});

describe('declineNotice', () => {
  it.each(declineCodes)('has danger copy for %s', (code) => {
    const notice = declineNotice(code);
    expect(notice.tone).toBe('danger');
    expect(notice.title).not.toBe('');
    expect(notice.body).toContain('Your spaces are still held.');
  });

  it('gives each code its own title', () => {
    const titles = declineCodes.map((code) => declineNotice(code).title);
    expect(new Set(titles).size).toBe(declineCodes.length);
  });

  it('reads an unknown code as a plain decline', () => {
    expect(declineNotice('processing_error')).toEqual(
      declineNotice('card_declined'),
    );
  });

  it('never repeats the raw code to the guest', () => {
    const notice = declineNotice('insufficient_funds');
    expect(`${notice.title} ${notice.body}`).not.toContain(
      'insufficient_funds',
    );
  });
});

describe('other notices', () => {
  it('names the wallet that was cancelled and says nothing was charged', () => {
    expect(walletCancelledNotice('google_pay')).toEqual({
      tone: 'info',
      title: 'Google Pay was cancelled',
      body: 'Nothing was charged. Choose a payment method to try again.',
    });
  });

  it('tells a guest with a lost connection not to pay again', () => {
    expect(connectionLostNotice.tone).toBe('warning');
    expect(connectionLostNotice.body).toContain("don't pay again");
  });

  it('tells a guest whose payment is closed to reload', () => {
    expect(refusedNotice.tone).toBe('danger');
    expect(refusedNotice.body).toContain('Reload the page');
  });
});
