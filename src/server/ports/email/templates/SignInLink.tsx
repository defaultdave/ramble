import 'server-only';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout } from './EmailLayout';
import {
  EmailButton,
  EmailHeading,
  EmailParagraph,
  EmailTextLink,
} from './EmailParts';

type Props = {
  data: EmailTemplateData<'sign-in-link'>;
  helpUrl: string;
};

/** The sign-in link: one button, the same address in plain text, and what to do if it was not asked for. */
export function SignInLink({ data, helpUrl }: Props) {
  const minutes = `${String(data.expiresInMinutes)} minutes`;
  return (
    <EmailLayout previewText="Your Ramble sign-in link." helpUrl={helpUrl}>
      <EmailHeading>Sign in to Ramble</EmailHeading>
      <EmailParagraph>
        {`Use this link to sign in. It works once and expires in ${minutes}.`}
      </EmailParagraph>
      <EmailButton href={data.url}>Sign in</EmailButton>
      <EmailParagraph muted>
        {'If the button does not work, copy this address into your browser: '}
        <EmailTextLink href={data.url}>{data.url}</EmailTextLink>
      </EmailParagraph>
      <EmailParagraph muted>
        If you did not ask for this link, you can ignore this email.
      </EmailParagraph>
    </EmailLayout>
  );
}
