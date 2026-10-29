import {
  connectionLostNotice,
  declineNotice,
  refusedNotice,
  walletCancelledNotice,
  type FakeConfirmResult,
  type FakeWallet,
  type NoticeCopy,
} from '@/lib/fakePayment';

/** The panel the guest was on when they sent an answer; it stays on screen, locked, until the reply. */
export type ConfirmingFrom =
  | { step: 'entering' }
  | { step: 'challenge' }
  | { step: 'wallet'; wallet: FakeWallet };

/** Where the guest is in the fake card form. */
export type FlowState =
  | { step: 'entering'; notice: NoticeCopy | null }
  | { step: 'confirming'; from: ConfirmingFrom }
  | { step: 'challenge' }
  | { step: 'wallet'; wallet: FakeWallet }
  | { step: 'succeeded' }
  | { step: 'lost' };

export type FlowEvent =
  | { type: 'submitted' }
  | { type: 'confirmed'; result: FakeConfirmResult }
  | { type: 'connection_lost' }
  | { type: 'wallet_opened'; wallet: FakeWallet }
  | { type: 'wallet_cancelled' };

export const initialFlow: FlowState = { step: 'entering', notice: null };

/** A card, a 3-D Secure answer, or a wallet approval may be sent from these steps only. */
function confirmingFrom(state: FlowState): FlowState {
  switch (state.step) {
    case 'entering':
      return { step: 'confirming', from: { step: 'entering' } };
    case 'challenge':
      return { step: 'confirming', from: { step: 'challenge' } };
    case 'wallet':
      return {
        step: 'confirming',
        from: { step: 'wallet', wallet: state.wallet },
      };
    default:
      return state;
  }
}

function afterResult(result: FakeConfirmResult): FlowState {
  switch (result.status) {
    case 'succeeded':
      return { step: 'succeeded' };
    case 'requires_action':
      return { step: 'challenge' };
    case 'declined':
      return { step: 'entering', notice: declineNotice(result.failureCode) };
    case 'refused':
      return { step: 'entering', notice: refusedNotice };
  }
}

/**
 * Events that do not fit the current step change nothing, so a double tap or a late answer
 * cannot start a second payment or undo a finished one.
 */
export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'submitted':
      return confirmingFrom(state);
    case 'confirmed':
      return state.step === 'confirming' ? afterResult(event.result) : state;
    case 'connection_lost':
      return state.step === 'confirming' ? { step: 'lost' } : state;
    case 'wallet_opened':
      return state.step === 'entering'
        ? { step: 'wallet', wallet: event.wallet }
        : state;
    case 'wallet_cancelled':
      return state.step === 'wallet'
        ? { step: 'entering', notice: walletCancelledNotice(state.wallet) }
        : state;
  }
}

/** The notice shown above the form for this state, if any. */
export function flowNotice(state: FlowState): NoticeCopy | null {
  if (state.step === 'entering') return state.notice;
  if (state.step === 'lost') return connectionLostNotice;
  return null;
}

/** Whether the guest is on the 3-D Secure or wallet sheet, including while an answer from it is in flight. */
export function onSheet(state: FlowState): boolean {
  const step = state.step === 'confirming' ? state.from.step : state.step;
  return step === 'challenge' || step === 'wallet';
}

export type FocusTarget = 'sheet' | 'notice' | 'pay';

/**
 * Where keyboard focus goes after a step change, so it never falls to the page when a sheet
 * unmounts: into a sheet when it opens, and back to the notice (or Pay) when it closes.
 * `fromSheet` is whether the step before this one was on a sheet.
 */
export function focusTarget(
  fromSheet: boolean,
  state: FlowState,
): FocusTarget | null {
  if (state.step === 'challenge' || state.step === 'wallet') return 'sheet';
  if (state.step === 'entering' && fromSheet) {
    return state.notice ? 'notice' : 'pay';
  }
  return null;
}
