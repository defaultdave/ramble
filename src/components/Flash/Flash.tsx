import { Alert } from '@/components/Alert';
import type { FlashMessage } from '@/lib/flash';

export type FlashProps = {
  /** What the page read from the flash cookie with `parseFlash`; null shows nothing. */
  flash: FlashMessage | null;
};

/** TODO(U-073): first caller. The one-line result of a Server Action, shown on the page the action sent the user to. */
export function Flash({ flash }: FlashProps) {
  if (flash === null) return null;
  return <Alert tone={flash.tone} title={flash.message} />;
}
