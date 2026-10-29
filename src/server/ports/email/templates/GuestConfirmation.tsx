import 'server-only';
import { guestConfirmationBody } from '@/lib/email/bookingBody';
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
};

/** The guest's confirmation (PRD-25). */
export function GuestConfirmation({ data, helpUrl }: Props) {
  const body = guestConfirmationBody(data);
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
