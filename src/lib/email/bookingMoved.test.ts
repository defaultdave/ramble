import { describe, expect, it } from 'vitest';
import { guestConfirmationData, moveEmailKey } from '../bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '../bookingEmails.fixtures';
import { bookingMovedBody, guestConfirmationBody } from './bookingBody';
import { calendarFilename } from './bookingTemplates';
import { attachmentsFor, parseEmailRequest, subjectFor } from './templates';

// Behaviours under test, one per decision or risk (the move confirmation email):
// - it takes the confirmation's data and refuses what the confirmation refuses (a link that is not http(s))
// - its subject says the booking moved, names the new day, and cuts the name to one line
// - its heading and intro say the booking moved and the price did not change; every row is the confirmation's rows
// - it carries the calendar file for the new date, byte for byte the confirmation's, and the manage link
// - one key per move, whatever the case of the id

const to = 'pat@example.com';

/** The object without the named keys. */
const without = (value: object, keys: readonly string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
const moved = guestConfirmationData(orderA, {
  appUrl,
  manageToken: fakeManageToken,
});
const request = (data: unknown) =>
  parseEmailRequest({
    template: 'booking-moved',
    to,
    data,
    idempotencyKey: 'k1',
  });

describe('the booking-moved template', () => {
  it('parses the confirmation data', () => {
    expect(request(moved)).toMatchObject({ template: 'booking-moved' });
  });

  it('refuses a manage link that is not http(s)', () => {
    expect(() =>
      request({ ...moved, manageUrl: 'javascript:alert(1)' }),
    ).toThrow();
  });

  it('refuses a missing field', () => {
    expect(() => request(without(moved, ['dayLabel']))).toThrow();
  });

  it('has a subject that says it moved and names the new day', () => {
    expect(subjectFor(request(moved))).toBe(
      'Your booking has moved: Sunset sail on the Hudson, Saturday, November 7, 2026',
    );
  });

  it('cuts a long experience name to one line in the subject', () => {
    const subject = subjectFor(
      request({ ...moved, experienceName: `${'Long '.repeat(30)}\nname` }),
    );

    expect(subject).not.toContain('\n');
    expect(subject.length).toBeLessThan(140);
  });

  it('carries the calendar file for the new date, the same as the confirmation', () => {
    const [file] = attachmentsFor(request(moved));

    expect(file).toMatchObject({
      filename: calendarFilename,
      contentType: 'text/calendar; charset=utf-8',
    });
    expect(file?.content).toContain(moved.calendar.uid);
    expect(file?.content).toContain('DTSTART:20261107T210000Z');
    expect(attachmentsFor(request(moved))).toEqual(
      attachmentsFor({
        template: 'guest-confirmation',
        to,
        data: moved,
        idempotencyKey: 'k1',
      }),
    );
  });
});

describe('bookingMovedBody', () => {
  it('says the booking moved and the price did not change', () => {
    const body = bookingMovedBody(moved);

    expect(body.heading).toBe('Your booking has moved');
    expect(body.preview).toBe(
      'Your booking for Sunset sail on the Hudson has moved to Saturday, November 7, 2026.',
    );
    expect(body.intro).toBe(
      'Hi Pat Rivera, your booking is now on Saturday, November 7, 2026 at 4:00 PM EST. The price has not changed. A calendar file for the new date is attached.',
    );
  });

  it('keeps every row, term, and label of the confirmation', () => {
    const words = ['heading', 'intro', 'preview'] as const;
    const body = bookingMovedBody(moved);

    expect(without(body, words)).toEqual(
      without(guestConfirmationBody(moved), words),
    );
    expect(words.map((word) => body[word]).join(' ')).not.toContain('\u2014');
  });

  it('keeps a gift booking gift rows', () => {
    const gift = guestConfirmationData(orderB, {
      appUrl,
      manageToken: fakeManageToken,
    });

    expect(
      bookingMovedBody(gift).paymentRows.map((row) => row.label),
    ).toContain('Paid with your gift');
  });
});

describe('moveEmailKey', () => {
  it('is one key per move, the same for either case of the id', () => {
    const id = 'AAAAAAAA-0000-4000-8000-000000000001';

    expect(moveEmailKey(id)).toBe(
      'guest-move-confirmation:aaaaaaaa-0000-4000-8000-000000000001',
    );
    expect(moveEmailKey(id)).toBe(moveEmailKey(id.toLowerCase()));
    expect(moveEmailKey(id)).not.toBe(
      moveEmailKey('AAAAAAAA-0000-4000-8000-000000000002'),
    );
  });
});
