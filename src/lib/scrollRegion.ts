export type ScrollExtent = {
  scrollWidth: number;
  clientWidth: number;
};

/** Whether a box holds more across than it shows, so a guest has something to scroll to. */
export function scrollsSideways({
  scrollWidth,
  clientWidth,
}: ScrollExtent): boolean {
  return scrollWidth > clientWidth;
}

/**
 * The tab stop a scroll region takes. A region that scrolls is in the tab order. One that stopped
 * scrolling while it holds focus stays focusable, out of the tab order, so focus is not dropped to
 * the page; once it is left it takes no stop at all.
 */
export function scrollRegionTabIndex(
  scrolls: boolean,
  hasFocus: boolean,
): 0 | -1 | undefined {
  if (scrolls) {
    return 0;
  }
  return hasFocus ? -1 : undefined;
}
