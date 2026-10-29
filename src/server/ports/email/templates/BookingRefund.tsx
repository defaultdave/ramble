import 'server-only';
import { bookingRefundBody } from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import { EmailDetails, EmailHeading, EmailParagraph } from './EmailParts';

type Props = {
  data: EmailTemplateData<'booking-refund'>;
  helpUrl: string;
};

/** Sent when the provider confirms a refund. */
export function BookingRefund({ data, helpUrl }: Props) {
  const body = bookingRefundBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
    </EmailLayout>
  );
}
