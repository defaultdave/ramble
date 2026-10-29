import { describe, expect, it } from 'vitest';
import {
  connectionLostNotice,
  declineNotice,
  refusedNotice,
  walletCancelledNotice,
} from './fakePayment';
import {
  flowNotice,
  flowReducer,
  focusTarget,
  onSheet,
  initialFlow,
  type FlowEvent,
  type FlowState,
} from './fakePaymentFlow';

const confirmingCard: FlowState = {
  step: 'confirming',
  from: { step: 'entering' },
};

describe('flowReducer', () => {
  it.each<[string, FlowState, FlowEvent, FlowState]>([
    ['a card is sent', initialFlow, { type: 'submitted' }, confirmingCard],
    [
      'a 3-D Secure answer is sent',
      { step: 'challenge' },
      { type: 'submitted' },
      { step: 'confirming', from: { step: 'challenge' } },
    ],
    [
      'a wallet is approved',
      { step: 'wallet', wallet: 'apple_pay' },
      { type: 'submitted' },
      {
        step: 'confirming',
        from: { step: 'wallet', wallet: 'apple_pay' },
      },
    ],
    [
      'the payment succeeds',
      confirmingCard,
      { type: 'confirmed', result: { status: 'succeeded' } },
      { step: 'succeeded' },
    ],
    [
      'the bank asks for 3-D Secure',
      confirmingCard,
      { type: 'confirmed', result: { status: 'requires_action' } },
      { step: 'challenge' },
    ],
    [
      'the card is declined',
      confirmingCard,
      {
        type: 'confirmed',
        result: { status: 'declined', failureCode: 'expired_card' },
      },
      { step: 'entering', notice: declineNotice('expired_card') },
    ],
    [
      'the guest fails 3-D Secure',
      { step: 'confirming', from: { step: 'challenge' } },
      {
        type: 'confirmed',
        result: { status: 'declined', failureCode: 'authentication_failed' },
      },
      { step: 'entering', notice: declineNotice('authentication_failed') },
    ],
    [
      'the gateway refuses',
      confirmingCard,
      { type: 'confirmed', result: { status: 'refused' } },
      { step: 'entering', notice: refusedNotice },
    ],
    [
      'the answer is lost',
      confirmingCard,
      { type: 'connection_lost' },
      { step: 'lost' },
    ],
    [
      'a wallet button is tapped',
      initialFlow,
      { type: 'wallet_opened', wallet: 'google_pay' },
      { step: 'wallet', wallet: 'google_pay' },
    ],
    [
      'the wallet sheet is cancelled',
      { step: 'wallet', wallet: 'google_pay' },
      { type: 'wallet_cancelled' },
      { step: 'entering', notice: walletCancelledNotice('google_pay') },
    ],
  ])('moves on when %s', (_name, from, event, to) => {
    expect(flowReducer(from, event)).toEqual(to);
  });

  it.each<[string, FlowState, FlowEvent]>([
    ['a second tap while sending', confirmingCard, { type: 'submitted' }],
    ['a send after success', { step: 'succeeded' }, { type: 'submitted' }],
    [
      'a send after the answer was lost',
      { step: 'lost' },
      { type: 'submitted' },
    ],
    [
      'an answer nobody asked for',
      initialFlow,
      { type: 'confirmed', result: { status: 'succeeded' } },
    ],
    [
      'a late success after a lost answer',
      { step: 'lost' },
      { type: 'confirmed', result: { status: 'succeeded' } },
    ],
    [
      'a lost answer after success',
      { step: 'succeeded' },
      { type: 'connection_lost' },
    ],
    [
      'a wallet opened during 3-D Secure',
      { step: 'challenge' },
      { type: 'wallet_opened', wallet: 'apple_pay' },
    ],
    [
      'a wallet cancelled while sending',
      { step: 'confirming', from: { step: 'wallet', wallet: 'apple_pay' } },
      { type: 'wallet_cancelled' },
    ],
  ])('stays put on %s', (_name, state, event) => {
    expect(flowReducer(state, event)).toBe(state);
  });
});

describe('flowNotice', () => {
  it('shows the notice a card form carries', () => {
    expect(flowNotice({ step: 'entering', notice: refusedNotice })).toBe(
      refusedNotice,
    );
  });

  it('shows the lost-connection notice once the answer is lost', () => {
    expect(flowNotice({ step: 'lost' })).toBe(connectionLostNotice);
  });

  it.each<FlowState>([
    initialFlow,
    confirmingCard,
    { step: 'challenge' },
    { step: 'wallet', wallet: 'apple_pay' },
    { step: 'succeeded' },
  ])('shows none on %j', (state) => {
    expect(flowNotice(state)).toBeNull();
  });
});

describe('onSheet', () => {
  it.each<[FlowState, boolean]>([
    [initialFlow, false],
    [{ step: 'challenge' }, true],
    [{ step: 'wallet', wallet: 'apple_pay' }, true],
    [{ step: 'confirming', from: { step: 'challenge' } }, true],
    [
      { step: 'confirming', from: { step: 'wallet', wallet: 'google_pay' } },
      true,
    ],
    [confirmingCard, false],
    [{ step: 'succeeded' }, false],
    [{ step: 'lost' }, false],
  ])('%j is %s', (state, expected) => {
    expect(onSheet(state)).toBe(expected);
  });
});

describe('focusTarget', () => {
  it.each<[string, boolean, FlowState, string | null]>([
    ['a sheet opens', false, { step: 'challenge' }, 'sheet'],
    [
      'a wallet sheet opens',
      false,
      { step: 'wallet', wallet: 'apple_pay' },
      'sheet',
    ],
    [
      'a sheet closes with a notice',
      true,
      { step: 'entering', notice: refusedNotice },
      'notice',
    ],
    ['a sheet closes with none', true, initialFlow, 'pay'],
    [
      'the form shows a notice but no sheet was open',
      false,
      { step: 'entering', notice: refusedNotice },
      null,
    ],
    [
      'a send starts from a sheet',
      true,
      { step: 'confirming', from: { step: 'challenge' } },
      null,
    ],
    ['the payment goes through', true, { step: 'succeeded' }, null],
    ['the answer is lost', true, { step: 'lost' }, null],
  ])('when %s', (_name, fromSheet, state, expected) => {
    expect(focusTarget(fromSheet, state)).toBe(expected);
  });
});
