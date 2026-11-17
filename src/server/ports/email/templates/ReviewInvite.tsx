import 'server-only';
import { reviewInviteBody } from '@/lib/email/reviewInvite';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailTextLink,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'review-invite'>;
  helpUrl: string;
};

/** The invite to review a session that has taken place: one button to the review form, and the link written out for a client that blocks buttons. */
export function ReviewInvite({ data, helpUrl }: Props) {
  const body = reviewInviteBody(data);
  return (
    <EmailLayout previewText={body.preview} helpUrl={helpUrl}>
      <EmailHeading>{body.heading}</EmailHeading>
      <EmailParagraph>{body.greeting}</EmailParagraph>
      <EmailParagraph>{body.intro}</EmailParagraph>
      <EmailButton href={data.reviewUrl}>{body.buttonLabel}</EmailButton>
      <EmailParagraph muted>
        <EmailTextLink href={data.reviewUrl}>{data.reviewUrl}</EmailTextLink>
      </EmailParagraph>
      <EmailParagraph muted>{body.note}</EmailParagraph>
    </EmailLayout>
  );
}
