export type StickyTopInput = {
  /** The `top` the panel has stuck at so far, in pixels from the window's top edge. */
  previousTop: number;
  /** How far the page scrolled since then; positive is down. */
  scrollDelta: number;
  viewportHeight: number;
  panelHeight: number;
  /** The room kept above the panel, and the same room below it. */
  offset: number;
};

/**
 * Where a sticky panel taller than the window should stick. It moves with the page until its bottom
 * edge reaches the window's bottom (less the offset) while scrolling down, or its top edge reaches
 * the offset while scrolling up, and holds there. A panel that fits sticks at the offset.
 */
export function stickyTop({
  previousTop,
  scrollDelta,
  viewportHeight,
  panelHeight,
  offset,
}: StickyTopInput): number {
  const lowest = viewportHeight - panelHeight - offset;
  if (lowest >= offset) {
    return offset;
  }
  return Math.min(offset, Math.max(lowest, previousTop - scrollDelta));
}
