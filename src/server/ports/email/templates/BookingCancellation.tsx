import 'server-only';
import { bookingCancellationBody } from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailDetails,
  EmailHeading,
  EmailParagraph,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'booking-cancellation'>;
  helpUrl: string;
};

/** The cancellation notice (PRD-44), for the guest or the host. */
export function BookingCancellation({ data, helpUrl }: Props) {
  const body = bookingCancellationBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
      {body.refundLine ? (
        <EmailParagraph>{body.refundLine}</EmailParagraph>
      ) : null}
      {data.otherDatesUrl ? (
        <EmailButton href={data.otherDatesUrl}>
          {body.otherDatesLabel}
        </EmailButton>
      ) : null}
    </EmailLayout>
  );
}
