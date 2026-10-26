import 'server-only';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'react-email';
import type { CSSProperties, ReactNode } from 'react';

// Mail clients read neither CSS variables nor class names from our stylesheets, so these are the
// resolved values of the palette tokens named beside each one (src/styles/tokens.css).
export const emailColors = {
  canvas: '#fbf6ee', // palette-ink-50
  surface: '#ffffff', // palette-white
  text: '#211a16', // palette-ink-850
  textMuted: '#5c5048', // palette-ink-600
  border: '#e3d6c4', // palette-ink-200
  link: '#a3321f', // palette-tomato-700
} as const;

const fontFamily = 'Georgia, "Times New Roman", serif';

const styles = {
  body: {
    margin: 0,
    padding: '24px 12px',
    backgroundColor: emailColors.canvas,
    color: emailColors.text,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
    fontSize: '16px',
    lineHeight: '24px',
  },
  container: {
    maxWidth: '560px',
    margin: '0 auto',
    padding: '24px',
    backgroundColor: emailColors.surface,
    border: `1px solid ${emailColors.border}`,
    borderRadius: '8px',
  },
  wordmark: {
    margin: '0 0 16px',
    fontFamily,
    fontSize: '28px',
    lineHeight: '32px',
    fontWeight: 700,
    color: emailColors.text,
  },
  rule: {
    border: 'none',
    borderTop: `1px solid ${emailColors.border}`,
    margin: '24px 0 16px',
  },
  footer: {
    margin: 0,
    fontSize: '14px',
    lineHeight: '20px',
    color: emailColors.textMuted,
  },
  link: { color: emailColors.link, textDecoration: 'underline' },
} satisfies Record<string, CSSProperties>;

export type EmailLayoutProps = {
  /** The inbox preview line; also read aloud first by screen readers. */
  previewText: string;
  /** Where the footer's help link points. */
  helpUrl: string;
  children: ReactNode;
};

/** The frame every Ramble email shares: wordmark, content, and a footer with the help link. */
export function EmailLayout({
  previewText,
  helpUrl,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Ramble</Text>
          <Section>{children}</Section>
          <Hr style={styles.rule} />
          <Text style={styles.footer}>
            Questions? Reply to this email, or visit our{' '}
            <Link href={helpUrl} style={styles.link}>
              help page
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
