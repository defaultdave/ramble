import { Alert } from '@/components/Alert';
import { hostNotices, type HostNoticeCode } from '@/lib/hostSetup';

/** The one-line result of an action, which sent the person here with its code in the address. */
export function HostNotice({ code }: { code: HostNoticeCode | null }) {
  if (code === null) return null;
  const notice = hostNotices[code];
  return <Alert tone={notice.tone} title={notice.title} />;
}
