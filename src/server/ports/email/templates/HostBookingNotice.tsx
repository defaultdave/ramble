import 'server-only';
import { hostBookingNoticeBody } from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import { EmailDetails, EmailHeading, EmailParagraph } from './EmailParts';

type Props = {
  data: EmailTemplateData<'host-booking-notice'>;
  helpUrl: string;
};

/** The host's notice of a new booking (PRD-44). */
export function HostBookingNotice({ data, helpUrl }: Props) {
  const body = hostBookingNoticeBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
    </EmailLayout>
  );
}
