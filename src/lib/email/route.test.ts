import { describe, expect, it } from 'vitest';
import { chooseAdapter, type EmailMode } from './route';
import type { EmailAdapterName } from './message';

// Behaviours under test, one per branch:
// - sink keeps everything in the fake adapter whatever provider is configured
// - allowlist sends listed recipients through the provider and keeps the rest in the fake adapter
// - live sends everyone through the provider
// - a fake provider is the fake adapter in every mode

const allowlist = ['dave@example.com', '@team.example.org'];

it.each<[EmailMode, EmailAdapterName, string, EmailAdapterName]>([
  ['sink', 'resend', 'dave@example.com', 'fake'],
  ['sink', 'postmark', 'anyone@example.com', 'fake'],
  ['allowlist', 'resend', 'dave@example.com', 'resend'],
  ['allowlist', 'postmark', 'sam@team.example.org', 'postmark'],
  ['allowlist', 'resend', 'guest@example.com', 'fake'],
  ['live', 'resend', 'guest@example.com', 'resend'],
  ['live', 'postmark', 'dave@example.com', 'postmark'],
  ['sink', 'fake', 'dave@example.com', 'fake'],
  ['allowlist', 'fake', 'dave@example.com', 'fake'],
  ['live', 'fake', 'guest@example.com', 'fake'],
])('%s mode with %s sends %s through %s', (mode, provider, to, expected) => {
  expect(chooseAdapter({ mode, provider, allowlist, to })).toBe(expected);
});

describe('allowlist mode', () => {
  it('sends nobody out when the list is empty', () => {
    expect(
      chooseAdapter({
        mode: 'allowlist',
        provider: 'resend',
        allowlist: [],
        to: 'dave@example.com',
      }),
    ).toBe('fake');
  });
});
