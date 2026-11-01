export type DismissEvent = {
  /** Escape pressed with focus in the disclosure, or a press that landed somewhere. */
  kind: 'escape' | 'press';
  open: boolean;
  /** Whether a press landed inside the disclosure; Escape is only heard from inside, so it is true. */
  inside: boolean;
};

export type DismissAction = 'none' | 'close' | 'close-and-refocus';

/**
 * What a native disclosure (a `<details>`) does when it is dismissed. Escape closes it and returns
 * focus to its summary, where a keyboard guest was. A press outside closes it and leaves focus
 * with whatever the guest pressed. A closed disclosure, or a press inside, changes nothing.
 */
export function dismissAction({
  kind,
  open,
  inside,
}: DismissEvent): DismissAction {
  if (!open) return 'none';
  if (kind === 'escape') return 'close-and-refocus';
  return inside ? 'none' : 'close';
}
