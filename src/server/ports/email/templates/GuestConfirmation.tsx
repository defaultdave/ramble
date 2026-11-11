import 'server-only';
import {
  guestConfirmationBody,
  type ConfirmationBody,
} from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailDetails,
  EmailHeading,
  EmailParagraph,
  EmailTextLink,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'guest-confirmation'>;
  helpUrl: string;
  /** The words, when this is the confirmation of a booking that moved. */
  body?: ConfirmationBody;
};

/** The guest's confirmation (PRD-25), and with `body` the one a move sends. */
export function GuestConfirmation({
  data,
  helpUrl,
  body = guestConfirmationBody(data),
}: Props) {
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
      <EmailDetails rows={body.paymentRows} />
      <EmailParagraph muted>{body.terms}</EmailParagraph>
      <EmailButton href={data.manageUrl}>{body.manageLabel}</EmailButton>
      <EmailParagraph>
        <EmailTextLink href={data.calendarUrl}>
          {body.calendarLabel}
        </EmailTextLink>
      </EmailParagraph>
      <EmailParagraph muted>{body.forwardWarning}</EmailParagraph>
    </EmailLayout>
  );
}
