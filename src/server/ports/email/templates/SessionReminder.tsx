import 'server-only';
import { sessionReminderBody } from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailDetails,
  EmailHeading,
  EmailParagraph,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'session-reminder'>;
  helpUrl: string;
};

/** The guest's reminder that the session is coming up (PRD-27). */
export function SessionReminder({ data, helpUrl }: Props) {
  const body = sessionReminderBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
      <EmailButton href={data.manageUrl}>{body.manageLabel}</EmailButton>
    </EmailLayout>
  );
}
