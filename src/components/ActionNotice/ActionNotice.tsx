import { Alert } from '@/components/Alert';
import type { NoticeText } from '@/lib/opsForm';

/** The one-line result of an action, which sent the person here with its code in the address. Nothing when there is none. */
export function ActionNotice({ notice }: { notice: NoticeText | null }) {
  if (notice === null) return null;
  return <Alert tone={notice.tone} title={notice.title} />;
}
