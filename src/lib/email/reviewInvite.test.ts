import { describe, expect, it } from 'vitest';
import {
  ReviewInviteDataSchema,
  reviewInviteBody,
  reviewInviteData,
  reviewInviteSubject,
  reviewLink,
} from './reviewInvite';

// Behaviours under test:
// - the link opens the review form for the reference and token, on the app's own origin
// - a reference or token of the wrong shape is a bug in the caller: no link is made
// - the data greets the booker (or "there"), words the day in the session's zone, clips long names, and says how many days the link lasts
// - the subject names the experience on one line, and a long name is cut
// - the data schema refuses an address that is not http or https and an empty name
// - the body says one thing to do, and carries the days the link works for

const token = 'A'.repeat(43);
const reference = 'RMB-7K3M9Q';
const appUrl = 'https://ramble.example';
const source = {
  leadGuestName: 'Noor Haddad',
  experienceName: 'Sunset kayak on the Hudson',
  hostName: 'Hudson Paddle Club',
  startsAt: new Date('2026-11-15T22:00:00Z'),
  timeZone: 'America/New_York',
};

describe('reviewLink', () => {
  it('opens the review form for the reference and token on the app origin', () => {
    expect(reviewLink(reference, token, appUrl)).toBe(
      `https://ramble.example/review/${reference}/${token}`,
    );
  });

  it.each([
    ['a short token', reference, 'short'],
    ['a lower-case reference', 'rmb-7k3m9q', token],
    ['no reference', '', token],
  ])('refuses %s', (_label, ref, tok) => {
    expect(() => reviewLink(ref, tok, appUrl)).toThrow(RangeError);
  });
});

describe('reviewInviteData', () => {
  it('greets the booker, words the day in the session zone, and carries the link and its lifetime', () => {
    const data = reviewInviteData(source, { reference, token, appUrl });
    expect(data).toEqual({
      recipientName: 'Noor Haddad',
      experienceName: 'Sunset kayak on the Hudson',
      hostName: 'Hudson Paddle Club',
      dayLabel: 'Sunday, November 15, 2026',
      reviewUrl: `https://ramble.example/review/${reference}/${token}`,
      windowDays: 90,
    });
    expect(ReviewInviteDataSchema.safeParse(data).success).toBe(true);
  });

  it('greets a booker with no name as "there" and clips a long experience name to one line', () => {
    const data = reviewInviteData(
      {
        ...source,
        leadGuestName: null,
        experienceName: `Long\nname ${'x'.repeat(300)}`,
      },
      { reference, token, appUrl },
    );
    expect(data.recipientName).toBe('there');
    expect(data.experienceName).toHaveLength(200);
    expect(data.experienceName).not.toContain('\n');
    expect(ReviewInviteDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('reviewInviteSubject', () => {
  const data = reviewInviteData(source, { reference, token, appUrl });

  it('asks about the experience', () => {
    expect(reviewInviteSubject(data)).toBe(
      'How was Sunset kayak on the Hudson?',
    );
  });

  it('puts a long name on one line and cuts it', () => {
    const subject = reviewInviteSubject({
      ...data,
      experienceName: `Sunset\nkayak ${'x'.repeat(200)}`,
    });
    expect(subject).not.toContain('\n');
    expect(subject.length).toBeLessThan(90);
  });
});

describe('the data schema', () => {
  const data = reviewInviteData(source, { reference, token, appUrl });

  it.each([
    ['a javascript address', { reviewUrl: 'javascript:alert(1)' }],
    ['no experience name', { experienceName: '' }],
    ['a lifetime of zero days', { windowDays: 0 }],
  ])('refuses %s', (_label, override) => {
    expect(
      ReviewInviteDataSchema.safeParse({ ...data, ...override }).success,
    ).toBe(false);
  });
});

describe('reviewInviteBody', () => {
  it('names the experience and host, has one button, and says how long the link works', () => {
    const body = reviewInviteBody(
      reviewInviteData(source, { reference, token, appUrl }),
    );
    expect(body.heading).toBe('How was Sunset kayak on the Hudson?');
    expect(body.intro).toContain('Hudson Paddle Club');
    expect(body.intro).toContain('Sunday, November 15, 2026');
    expect(body.buttonLabel).toBe('Write a review');
    expect(body.note).toContain('90 days');
  });
});
