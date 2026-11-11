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
  data: EmailTemplateData<'host-invite'>;
  helpUrl: string;
};

/** The first sign-in link for a host owner: who they are set up for, one button, and where to ask again once it lapses. */
export function HostInvite({ data, helpUrl }: Props) {
  const minutes = `${String(data.expiresInMinutes)} minutes`;
  return (
    <EmailLayout previewText="You are set up on Ramble." helpUrl={helpUrl}>
      <EmailHeading>{`You are set up on Ramble as the owner of ${data.hostName}`}</EmailHeading>
      <EmailParagraph>
        {`Use this link to sign in for the first time. It works once and expires in ${minutes}.`}
      </EmailParagraph>
      <EmailButton href={data.url}>Sign in</EmailButton>
      <EmailParagraph muted>
        {'If the button does not work, copy this address into your browser: '}
        <EmailTextLink href={data.url}>{data.url}</EmailTextLink>
      </EmailParagraph>
      <EmailParagraph muted>
        {'If the link has lapsed, ask for a new one at '}
        <EmailTextLink href={data.signInUrl}>{data.signInUrl}</EmailTextLink>
        {' with this email address.'}
      </EmailParagraph>
    </EmailLayout>
  );
}
