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
