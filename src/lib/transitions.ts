/** From each status, the statuses a row may move to. A status with an empty list is terminal. */
export type TransitionTable<S extends string> = Readonly<
  Record<S, readonly S[]>
>;

export function canTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}

export function isTerminal<S extends string>(
  table: TransitionTable<S>,
  status: S,
): boolean {
  return table[status].length === 0;
}

export const giftStatuses = [
  'pending_payment',
  'scheduled',
  'delivered',
  'redeemed',
] as const;
export type GiftStatus = (typeof giftStatuses)[number];

/**
 * Every gift moves along this table and no other (design doc 4.2.3, Gift transitions). A redeemed
 * gift returns to `delivered` when its booking is cancelled. The refund states are not built, so
 * no gift leaves for a refund.
 */
export const giftTransitions = {
  pending_payment: ['scheduled'],
  scheduled: ['delivered'],
  delivered: ['redeemed'],
  redeemed: ['delivered'],
} as const satisfies TransitionTable<GiftStatus>;

export function requireGiftTransition(from: GiftStatus, to: GiftStatus): void {
  if (!canTransition(giftTransitions, from, to)) {
    throw new Error(`A gift does not move from ${from} to ${to}`);
  }
}
