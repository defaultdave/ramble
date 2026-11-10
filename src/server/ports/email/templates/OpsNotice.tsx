import 'server-only';
import { Section, Text } from 'react-email';
import { Fragment, type CSSProperties } from 'react';
import type { EmailTemplateData } from '@/lib/email/templates';
import { opsNoticeSubject } from '@/lib/email/opsNotice';
import { EmailLayout, emailColors } from './EmailLayout';
import { EmailHeading } from './EmailParts';

type Props = {
  data: EmailTemplateData<'ops-notice'>;
  helpUrl: string;
};

const styles = {
  label: {
    margin: '0 0 2px',
    fontSize: '14px',
    lineHeight: '20px',
    color: emailColors.textMuted,
  },
  value: {
    margin: '0 0 16px',
    fontSize: '16px',
    lineHeight: '24px',
    overflowWrap: 'anywhere',
  },
} satisfies Record<string, CSSProperties>;

/** A notice to Ramble's own operations address: the subject as the heading, then each labelled field. Never sent to a guest. */
export function OpsNotice({ data, helpUrl }: Props) {
  const subject = opsNoticeSubject(data);
  return (
    <EmailLayout previewText={subject} helpUrl={helpUrl}>
      <EmailHeading>{subject}</EmailHeading>
      <Section>
        {data.fields.map((field, position) => (
          <div key={`${String(position)}-${field.label}`}>
            <Text style={styles.label}>{field.label}</Text>
            <Text style={styles.value}>
              {field.value.split(/\r?\n/).map((line, index) => (
                // A message arrives with its own line breaks; the same text always splits the same way, so the position is the identity.
                <Fragment key={index}>
                  {index > 0 ? <br /> : null}
                  {line}
                </Fragment>
              ))}
            </Text>
          </div>
        ))}
      </Section>
    </EmailLayout>
  );
}
