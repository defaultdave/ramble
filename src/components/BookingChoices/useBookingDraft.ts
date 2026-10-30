import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  bookingReducer,
  effectOf,
  initialState,
  reserveInput,
  type BookingAction,
  type BookingMode,
  type BookingOffer,
  type BookingState,
} from '@/lib/bookingDraft';
import { somethingWentWrong } from '@/lib/bookingOutcome';
import type { SessionSummary } from '@/lib/holds';
import { reserveSpaces } from '@/server/actions/holds';

// One draft per experience, shared by the bar, the sheet, and the panel without a parent that holds
// it: each island subscribes to the same entry. The entry lives while any island is mounted, so
// leaving the page drops it and the next visit starts from its own `?date=`.
const states = new Map<string, BookingState>();
const listeners = new Map<string, Set<() => void>>();

function subscribeTo(key: string, listener: () => void) {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(key);
      states.delete(key);
    }
  };
}

/**
 * The date, time, and party chosen before a hold, and the hold itself. Every change goes through
 * `bookingReducer` and the request is built by `reserveInput`; this hook only holds the state and
 * calls `reserveSpaces` (a Server Action, so the bot check and the device's tries come first). A held
 * answer navigates to checkout; every other answer becomes a notice the sheet and the panel show.
 */
export function useBookingDraft(offer: BookingOffer) {
  const router = useRouter();
  const key = offer.experienceId;
  const initial = useMemo(() => initialState(offer), [offer]);

  const subscribe = useCallback(
    (listener: () => void) => subscribeTo(key, listener),
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => states.get(key) ?? initial,
    () => initial,
  );

  const dispatch = useCallback(
    (action: BookingAction) => {
      states.set(
        key,
        bookingReducer(offer, states.get(key) ?? initial, action),
      );
      listeners.get(key)?.forEach((listener) => {
        listener();
      });
    },
    [offer, key, initial],
  );

  const submit = useCallback(async () => {
    const current = states.get(key) ?? initial;
    const input = reserveInput(offer, current);
    if (!input || current.pending) return;
    dispatch({ type: 'submitStarted' });
    try {
      const effect = effectOf(offer, await reserveSpaces(input));
      dispatch({ type: 'submitDone', effect });
      if (effect.kind === 'held') router.push(effect.href);
    } catch {
      dispatch({ type: 'submitDone', effect: somethingWentWrong });
    }
  }, [offer, key, initial, dispatch, router]);

  const handlers = useMemo(
    () => ({
      onMode: (mode: BookingMode) => {
        dispatch({ type: 'setMode', mode });
      },
      onDate: (date: string) => {
        dispatch({ type: 'chooseDate', date });
      },
      onSession: (sessionId: string) => {
        dispatch({ type: 'chooseSession', sessionId });
      },
      onAdults: (value: number) => {
        dispatch({ type: 'setAdults', value });
      },
      onChildren: (value: number) => {
        dispatch({ type: 'setChildren', value });
      },
      onAlternative: (summary: SessionSummary) => {
        dispatch({ type: 'chooseAlternative', summary });
      },
      onOpen: () => {
        dispatch({ type: 'openSheet' });
      },
      onClose: () => {
        dispatch({ type: 'closeSheet' });
      },
    }),
    [dispatch],
  );

  return { state, handlers, submit };
}
