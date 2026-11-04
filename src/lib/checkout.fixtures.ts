import {
  type StartPaymentInput,
  type HeldItem,
  StartPaymentInputSchema,
} from './checkout';

export const holdId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const termsId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
export const waiverId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
export const sessionId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
export const at = new Date('2026-11-01T12:00:00.000Z');
export const minutes = (count: number) =>
  new Date(at.getTime() + count * 60_000);

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

export const adult: HeldItem = {
  priceOptionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  kind: 'adult',
  quantity: 2,
  unitPriceMinor: 8500,
  usesSpace: true,
};
export const child: HeldItem = {
  priceOptionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  kind: 'child',
  quantity: 1,
  unitPriceMinor: 4000,
  usesSpace: false,
};

export const attempt = (change: object = {}) => ({
  id: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  attemptNo: 1,
  status: 'created' as const,
  failedTries: 0,
  providerPaymentId: null,
  ...change,
});
