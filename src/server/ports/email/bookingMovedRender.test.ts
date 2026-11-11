import { describe, expect, it } from 'vitest';
import { guestConfirmationData } from '@/lib/bookingEmails';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '@/lib/bookingEmails.fixtures';
import { parseEmailRequest } from '@/lib/email/templates';
import { renderEmail } from './render';

// Behaviours under test, one per decision or risk (the move confirmation, rendered):
// - it says the booking moved and the price did not change, where the confirmation says "You're booked"
// - it shows the new date, the itemized total, the terms, the manage link, the calendar link, and carries one calendar file
// - a gift order shows the gift and the charge
// - it links to help, has no em dash, and its plain-text part has no markup

const render = (order: typeof orderA) =>
  renderEmail(
    parseEmailRequest({
      template: 'booking-moved',
      to: 'pat@example.com',
      data: guestConfirmationData(order, {
        appUrl,
        manageToken: fakeManageToken,
      }),
      idempotencyKey: 'move:render',
    }),
    appUrl,
  );

describe('the move confirmation', () => {
  it('says it moved, shows the new date and every link, and carries the calendar file', async () => {
    const { html, text, subject, attachments } = await render(orderA);

    expect(subject).toBe(
      'Your booking has moved: Sunset sail on the Hudson, Saturday, November 7, 2026',
    );
    for (const part of [
      'your booking is now on Saturday, November 7, 2026 at 4:00 PM EST',
      'The price has not changed',
      'Adult x 2',
      '$234.12',
      'Free cancellation until Fri, Nov 6, 4:00 PM EST.',
    ]) {
      expect(html).toContain(part);
      expect(text).toContain(part);
    }
    expect(html).toContain('Your booking has moved');
    expect(text).toContain('YOUR BOOKING HAS MOVED');
    expect(text).not.toContain("You're booked");
    expect(html).toContain(
      `href="https://ramble.example/manage/${fakeManageToken}"`,
    );
    expect(html).toContain(
      'href="https://calendar.google.com/calendar/render?',
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe('ramble-booking.ics');
  });

  it('shows the gift and the charge for a gift-paid booking', async () => {
    const { text } = await render(orderB);

    expect(text).toContain('Paid with your gift');
    expect(text).toContain('Charged to your card');
  });

  it('links to help, uses no em dash, and has a plain-text part with no markup', async () => {
    const { html, text, subject } = await render(orderA);

    expect(html).toContain('href="https://ramble.example/help"');
    for (const part of [html, text, subject]) {
      expect(part).not.toContain('—');
    }
    expect(text).not.toMatch(/<\/?[a-z]/i);
  });
});
