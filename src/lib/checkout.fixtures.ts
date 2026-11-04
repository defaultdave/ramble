import { StartPaymentInputSchema, type StartPaymentInput } from './checkout';
import { testIds } from './testIds';

export const holdId = testIds.hold;
export const termsId = testIds.terms;
export const waiverId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
export const sessionId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

export const validInput: StartPaymentInput = {
  holdId,
  contact: { email: 'pat@example.com', phone: '212-555-0100' },
  leadGuestName: 'Pat Smith',
  attendees: {},
  termsDocumentId: termsId,
  newsletterOptIn: false,
};

export const parsed = (change: object = {}) =>
  StartPaymentInputSchema.parse({ ...validInput, ...change });
