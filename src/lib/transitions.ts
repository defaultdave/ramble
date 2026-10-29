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

// TODO(U-049): first caller, the terminal-state guard in confirmOrder.
export function isTerminal<S extends string>(
  table: TransitionTable<S>,
  status: S,
): boolean {
  return table[status].length === 0;
}
