import 'server-only';

// TODO(U-005): replace with the Clock port; this is only the system reading it needs, so the fake gateway has a time source.
/** The system time, the one place server code outside tests reads it. */
export function systemNow(): Date {
  return new Date();
}
