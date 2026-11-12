import { Alert } from '@/components/Alert';
import {
  experienceNotices,
  type ExperienceNoticeCode,
} from '@/lib/experienceEditor';

/** The one-line result of an action, which sent the person here with its code in the address. */
export function ExperienceNotice({
  code,
}: {
  code: ExperienceNoticeCode | null;
}) {
  if (code === null) return null;
  const notice = experienceNotices[code];
  return <Alert tone={notice.tone} title={notice.title} />;
}
