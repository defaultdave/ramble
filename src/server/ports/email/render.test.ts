import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEmailRequest } from '@/lib/email/templates';
import { emailColors } from './templates/EmailLayout';
import { renderEmail } from './render';

// Behaviours under test, one per decision or risk:
// - the layout carries the preview line, the wordmark, the data, and an absolute help link
// - template data is escaped, so a name cannot inject markup
// - the plain-text part has no tags and still holds the help link
// - the subject comes from the registry
// - the layout colours are values of the palette tokens they name

const request = (recipientName: string) =>
  parseEmailRequest({
    template: 'dev-check',
    to: 'guest@example.com',
    data: { recipientName },
    idempotencyKey: 'render-1',
  });

describe('renderEmail', () => {
  it('renders the shared layout around the template', async () => {
    const { subject, html } = await renderEmail(
      request('Sam'),
      'https://ramble.example',
    );

    expect(subject).toBe('Ramble email check');
    expect(html).toContain('Ramble email is working.');
    expect(html).toContain('Email is working');
    expect(html).toContain('Hi Sam');
    expect(html).toContain('href="https://ramble.example/help"');
  });

  it('escapes the data it is given', async () => {
    const { html } = await renderEmail(
      request('<script>alert(1)</script>'),
      'https://ramble.example',
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('writes a plain-text part with no markup and the help link', async () => {
    const { text } = await renderEmail(
      request('Sam'),
      'https://ramble.example',
    );

    expect(text).not.toMatch(/<\/?[a-z]/i);
    expect(text).toContain('Hi Sam');
    expect(text).toContain('https://ramble.example/help');
  });
});

describe('email layout colours', () => {
  it('are palette values from the token file', () => {
    const tokens = readFileSync(
      path.resolve(import.meta.dirname, '../../../styles/tokens.css'),
      'utf8',
    );

    for (const color of Object.values(emailColors)) {
      expect(tokens).toContain(`: ${color};`);
    }
  });
});
