import 'server-only';
import { Heading, Text } from 'react-email';
import type { EmailTemplateData } from '@/lib/email/templates';
import { EmailLayout, emailColors } from './EmailLayout';

type DevCheckProps = {
  data: EmailTemplateData<'dev-check'>;
  helpUrl: string;
};

/** Proves the port, the layout, and the dev mailbox work end to end. Not sent to guests. */
export function DevCheck({ data, helpUrl }: DevCheckProps) {
  return (
    <EmailLayout previewText="Ramble email is working." helpUrl={helpUrl}>
      <Heading
        as="h1"
        style={{ margin: '0 0 12px', fontSize: '22px', lineHeight: '28px' }}
      >
        Email is working
      </Heading>
      <Text
        style={{
          margin: 0,
          fontSize: '16px',
          lineHeight: '24px',
          color: emailColors.text,
        }}
      >
        {`Hi ${data.recipientName}, this message came through Ramble's email port.`}
      </Text>
    </EmailLayout>
  );
}
