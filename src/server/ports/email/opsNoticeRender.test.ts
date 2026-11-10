import { describe, expect, it } from 'vitest';
import { opsNoticeLimits } from '@/lib/email/opsNotice';
import { parseEmailRequest, type EmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test, one per decision or risk:
// - the notice shows its subject as the subject line and heading, and each label with its value, in both parts
// - a message keeps its line breaks, and a value cannot inject markup
// - a subject with a line break is one line, so it cannot split the header
// - no fields, too many fields, a blank label, and a value over the limit are refused, not trimmed

const base = {
  subject: 'Contact form: A booking',
  fields: [
    { label: 'Name', value: 'Pat Smith' },
    { label: 'Message', value: 'First line\nSecond line' },
  ],
};

function request(data: unknown): EmailRequest {
  return parseEmailRequest({
    template: 'ops-notice',
    to: 'support@ramble.invalid',
    data,
    idempotencyKey: 'ops-notice:render',
  });
}

const render = (data: unknown) =>
  renderEmail(request(data), 'https://ramble.example');

describe('the ops-notice email', () => {
  it('shows the subject and every labelled field in both parts', async () => {
    const email = await render(base);

    expect(email.subject).toBe('Contact form: A booking');
    for (const part of [email.html, email.text]) {
      expect(part.toLowerCase()).toContain('contact form: a booking');
      expect(part).toContain('Pat Smith');
      expect(part).toContain('Message');
    }
  });

  it('keeps a message line breaks in the html and the text', async () => {
    const email = await render(base);

    expect(email.html).toMatch(/First line<br\s*\/?>Second line/);
    expect(email.text).toContain('First line\nSecond line');
  });

  it('escapes markup in a value', async () => {
    const email = await render({
      ...base,
      fields: [{ label: 'Message', value: '<script>alert(1)</script>' }],
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('collapses a subject to one line', async () => {
    const email = await render({ ...base, subject: 'Contact\r\nBcc: x@y.z' });

    expect(email.subject).toBe('Contact Bcc: x@y.z');
  });

  it.each([
    ['no fields', { fields: [] }],
    [
      'too many fields',
      {
        fields: Array.from(
          { length: opsNoticeLimits.maxFields + 1 },
          (_, n) => ({
            label: `L${String(n)}`,
            value: 'v',
          }),
        ),
      },
    ],
    ['a blank label', { fields: [{ label: '', value: 'v' }] }],
    [
      'a value over the limit',
      {
        fields: [
          { label: 'L', value: 'x'.repeat(opsNoticeLimits.valueMaxChars + 1) },
        ],
      },
    ],
    ['no subject', { subject: '' }],
  ])('refuses %s', (_label, override) => {
    expect(() => request({ ...base, ...override })).toThrow();
  });
});
