import type { DatePicker } from '@/components/DatePicker';

let ready: typeof DatePicker | null = null;

/**
 * The calendar brings react-aria with it, which a guest who never opens the date chip should not
 * download, so it is fetched when it is first wanted. A failed fetch rejects and a later call tries again.
 */
export function loadDatePicker() {
  return import('@/components/DatePicker').then(({ DatePicker: component }) => {
    ready = component;
    return component;
  });
}

/** The calendar if an earlier fetch has brought it, so a control that mounts later can show it in its first render. */
export function loadedDatePicker() {
  return ready;
}
