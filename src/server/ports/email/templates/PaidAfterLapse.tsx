import 'server-only';
import { paidAfterLapseBody } from '@/lib/email/bookingBody';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailDetails,
  EmailHeading,
  EmailParagraph,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'paid-after-lapse'>;
  helpUrl: string;
};

/** The S10 notice: paid after the hold lapsed, no space left, refunded in full. */
export function PaidAfterLapse({ data, helpUrl }: Props) {
  const body = paidAfterLapseBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailDetails rows={body.rows} />
      <EmailButton href={data.browseUrl}>{body.browseLabel}</EmailButton>
    </EmailLayout>
  );
}
