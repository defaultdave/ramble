import 'server-only';
import { Button, Heading, Link, Section, Text } from 'react-email';
import type { CSSProperties, ReactNode } from 'react';
import type { DetailRow } from '@/lib/email/bookingBody';
import { emailColors } from './EmailLayout';

// The pieces the booking emails share. They hold no wording: every string arrives finished.

const styles = {
  heading: { margin: '0 0 12px', fontSize: '22px', lineHeight: '28px' },
  paragraph: {
    margin: '0 0 16px',
    fontSize: '16px',
    lineHeight: '24px',
    color: emailColors.text,
  },
  muted: {
    margin: '0 0 16px',
    fontSize: '14px',
    lineHeight: '20px',
    color: emailColors.textMuted,
  },
  detailRow: { margin: '0 0 4px', fontSize: '16px', lineHeight: '24px' },
  detailLabel: { color: emailColors.textMuted },
  button: {
    display: 'inline-block',
    padding: '12px 20px',
    borderRadius: '6px',
    backgroundColor: emailColors.link,
    color: emailColors.surface,
    fontSize: '16px',
    fontWeight: 700,
    lineHeight: '24px',
    textDecoration: 'none',
  },
  link: { color: emailColors.link, textDecoration: 'underline' },
  actions: { margin: '8px 0 16px' },
} satisfies Record<string, CSSProperties>;

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading as="h1" style={styles.heading}>
      {children}
    </Heading>
  );
}

export function EmailParagraph({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <Text style={muted ? styles.muted : styles.paragraph}>{children}</Text>
  );
}

/** Label and value pairs, one per line, so a phone shows them without a table. */
export function EmailDetails({ rows }: { rows: readonly DetailRow[] }) {
  return (
    <Section style={{ margin: '0 0 16px' }}>
      {rows.map((row) => (
        <Text key={row.label} style={styles.detailRow}>
          <span style={styles.detailLabel}>{row.label}: </span>
          {row.value}
        </Text>
      ))}
    </Section>
  );
}

/** A call to action. The visible words say where it goes; the address follows in plain text. */
export function EmailButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section style={styles.actions}>
      <Button href={href} style={styles.button}>
        {children}
      </Button>
    </Section>
  );
}

export function EmailTextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} style={styles.link}>
      {children}
    </Link>
  );
}
