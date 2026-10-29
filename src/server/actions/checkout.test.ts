import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartPaymentInput } from '@/lib/checkout';
import { testDevice } from '../../../tests/deviceFixture';

const mocks = vi.hoisted(() => ({
  startCheckoutPayment: vi.fn(),
  getDevice: vi.fn(),
}));

vi.mock(
  'next/headers',
  async () => (await import('../../../tests/deviceFixture')).nextHeadersMock,
);
vi.mock('@/server/checkout', () => ({
  startCheckoutPayment: mocks.startCheckoutPayment,
}));
vi.mock('@/server/device', async (importActual) => ({
  ...(await importActual<typeof import('@/server/device')>()),
  getDevice: mocks.getDevice,
}));

import { startPayment } from './checkout';

// Behaviours under test, one per decision, branch or risk:
// - a form that does not parse is invalid and reaches no device or checkout step
// - a parsed form (ids lower-cased) goes to the checkout step with the calling device, and its answer is returned as is
// - a failure in the checkout step rejects, so nothing is answered as paid

const device = await testDevice('checkout-door');
const holdId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const input: StartPaymentInput = {
  holdId,
  contact: { email: 'pat@example.com' },
  leadGuestName: 'Pat Smith',
  attendees: {},
  termsDocumentId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  newsletterOptIn: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDevice.mockResolvedValue(device);
});

describe('the startPayment action', () => {
  it('is invalid when the form does not parse, and nothing else is touched', async () => {
    await expect(
      startPayment({ ...input, leadGuestName: ' ' }),
    ).resolves.toEqual({
      status: 'invalid',
      fieldErrors: { leadGuestName: 'invalid' },
    });
    expect(mocks.getDevice).not.toHaveBeenCalled();
    expect(mocks.startCheckoutPayment).not.toHaveBeenCalled();
  });

  it('passes the parsed form and the calling device on, and returns the answer', async () => {
    const answer = { status: 'too_many_tries' };
    mocks.startCheckoutPayment.mockResolvedValue(answer);

    await expect(
      startPayment({ ...input, holdId: holdId.toUpperCase() }),
    ).resolves.toBe(answer);
    expect(mocks.startCheckoutPayment).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ holdId }),
    );
  });

  it('rejects when the checkout step fails', async () => {
    mocks.startCheckoutPayment.mockRejectedValue(new Error('provider down'));

    await expect(startPayment(input)).rejects.toThrow('provider down');
  });
});
