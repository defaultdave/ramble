import { blocks } from '../richText';
import type { LegalFixture } from '../types';

// Plain demo text. No counsel has reviewed it, and each document says so, because Ramble is a
// demo and no real money moves (PRD section 11).
const demoNotice =
  'Ramble is a demo marketplace. Nothing here is legal advice, no payment is taken, and no counsel has reviewed this text.';

export const legal: LegalFixture[] = [
  {
    doc: 'terms',
    title: 'Terms of service',
    body: blocks(
      demoNotice,
      { heading: 'Booking' },
      'Ramble lists experiences run by independent hosts. When you book, you are booking with the host, and Ramble collects the payment and sends your confirmation.',
      { heading: 'Cancelling' },
      'Each experience states its cancellation terms with a real date and time before you pay. If a host or the weather cancels, you are refunded in full.',
      { heading: 'Your account' },
      'You can book without an account. Your confirmation email carries a private link to manage your booking.',
    ),
  },
  {
    doc: 'privacy',
    title: 'Privacy policy',
    body: blocks(
      demoNotice,
      { heading: 'What we keep' },
      'We keep the name and email you give us at checkout, the booking you made, and the messages we sent about it.',
      { heading: 'What we do not do' },
      'We do not sell your details, and we do not add you to the newsletter unless you tick the box yourself.',
    ),
  },
  {
    doc: 'host-agreement',
    title: 'Host agreement',
    body: blocks(
      demoNotice,
      { heading: 'Your listings' },
      'You describe your experience honestly, keep your calendar current, and run the sessions you sell.',
      { heading: 'Payouts' },
      'Ramble pays you after each session, less the commission agreed when you were onboarded.',
    ),
  },
  {
    doc: 'waiver-hudson-paddle-club',
    title: 'Hudson Paddle Club waiver',
    body: blocks(
      demoNotice,
      { heading: 'Time on the water' },
      'Paddling carries real risks, including tipping over, cold water, and other boats. You wear a life jacket for the whole session and follow your guide.',
      { heading: 'If you tip over' },
      'Guides are trained in water rescue and will help you back in. Tell your guide before you start if you cannot swim or have a condition they should know about.',
    ),
  },
];
