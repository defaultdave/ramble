export type DismissEvent = {
  /**
   * Escape pressed with focus in the disclosure, a press that landed somewhere, focus that moved
   * away, or a click on a link inside it.
   */
  kind: 'escape' | 'press' | 'focus-out' | 'link-click';
  open: boolean;
  /**
   * Whether a press landed, or focus went, inside the disclosure; Escape and a link click are only
   * heard from inside, so they are true. Null when focus went to nothing the page can name (the
   * window lost it, or a press landed on blank space), which says nothing about leaving.
   */
  inside: boolean | null;
};

export type DismissAction = 'none' | 'close' | 'close-and-refocus';

/**
 * What a native disclosure (a `<details>`) does when it is dismissed. Escape closes it and returns
 * focus to its summary, where a keyboard guest was. A press outside, or focus tabbing out to
 * another element, closes it and leaves focus where the guest put it. A link clicked inside closes
 * it, because the page it opens may be this one and keep the disclosure mounted. A closed
 * disclosure, a press or focus inside, and focus that went nowhere known change nothing.
 */
export function dismissAction({
  kind,
  open,
  inside,
}: DismissEvent): DismissAction {
  if (!open) return 'none';
  if (kind === 'escape') return 'close-and-refocus';
  if (kind === 'link-click') return 'close';
  return inside === false ? 'close' : 'none';
}
