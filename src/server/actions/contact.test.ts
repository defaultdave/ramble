import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import type { SupportFormState } from '@/lib/support';

const mocks = vi.hoisted(() => ({
  headerGet: vi.fn(),
  checkFormGuard: vi.fn(),
  consumeRateLimit: vi.fn(),
  transaction: vi.fn(),
  insertSupportRequest: vi.fn(),
  enqueue: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: mocks.headerGet }),
}));
vi.mock('@/server/formGuard', () => ({
  checkFormGuard: mocks.checkFormGuard,
}));
vi.mock('@/server/ports/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/server/db/client', () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock('@/server/db/support', () => ({
  insertSupportRequest: mocks.insertSupportRequest,
}));
vi.mock('@/server/jobs/enqueue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: mocks.logError },
}));

import { submitSupportRequest } from './contact';

// Behaviours under test, one per decision, branch or risk:
// - a valid form writes the request and queues the ops notice in one transaction, and says sent
// - the notice carries the labelled fields and a dedupe key built from the request id
// - a guard refusal (honeypot, forged or too-fast token) gets the reply a success gets and writes and counts nothing
// - an expired form asks for a reload and keeps what was typed
// - a form that fails validation returns its field errors and values, and costs no rate-limit try
// - the rate limit is per address and form, and a refusal writes nothing
// - a failed write or a failed limiter answers failed, and the log holds the error kind and nothing the guest typed

const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields = {
    name: 'Pat Smith',
    email: 'Pat@Example.com',
    topic: 'refund',
    message: 'I was charged twice.',
    [FORM_TOKEN_FIELD]: 'token',
    [HONEYPOT_FIELD]: '',
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const idle: SupportFormState = { status: 'idle' };
const tx = { marker: 'tx' };
const stored = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  createdAt: new Date('2026-11-10T12:00:00Z'),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headerGet.mockReturnValue('203.0.113.9, 10.0.0.1');
  mocks.checkFormGuard.mockReturnValue({ ok: true });
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
  mocks.transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(tx),
  );
  mocks.insertSupportRequest.mockResolvedValue(stored);
  mocks.enqueue.mockResolvedValue({ id: 'job' });
});

describe('the submitSupportRequest action', () => {
  it('writes the request and queues the ops notice in one transaction', async () => {
    await expect(submitSupportRequest(idle, form())).resolves.toEqual({
      status: 'sent',
    });

    expect(mocks.insertSupportRequest).toHaveBeenCalledWith(tx, {
      name: 'Pat Smith',
      email: 'pat@example.com',
      topic: 'refund',
      message: 'I was charged twice.',
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, {
      kind: 'ops-notice',
      payload: {
        subject: 'Contact form: A refund or payment',
        fields: [
          { label: 'Name', value: 'Pat Smith' },
          { label: 'Email', value: 'pat@example.com' },
          { label: 'Topic', value: 'A refund or payment' },
          { label: 'Message', value: 'I was charged twice.' },
          { label: 'Request ID', value: stored.id },
          { label: 'Received', value: '2026-11-10T12:00:00.000Z' },
        ],
      },
      dedupeKey: `support-request:${stored.id}`,
    });
  });

  it.each(['honeypot_filled', 'too_fast', 'invalid_token'])(
    'answers sent and does nothing else when the guard says %s',
    async (reason) => {
      mocks.checkFormGuard.mockReturnValue({ ok: false, reason });

      await expect(submitSupportRequest(idle, form())).resolves.toEqual({
        status: 'sent',
      });

      expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it('asks for a reload when the form expired, and keeps what was typed', async () => {
    mocks.checkFormGuard.mockReturnValue({ ok: false, reason: 'expired' });

    await expect(submitSupportRequest(idle, form())).resolves.toEqual({
      status: 'expired',
      values: {
        name: 'Pat Smith',
        email: 'Pat@Example.com',
        topic: 'refund',
        message: 'I was charged twice.',
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('hands the guard the honeypot as an absent value when the form lacks it', async () => {
    const data = form();
    data.delete(HONEYPOT_FIELD);

    await submitSupportRequest(idle, data);

    expect(mocks.checkFormGuard).toHaveBeenCalledWith(
      { [HONEYPOT_FIELD]: undefined, [FORM_TOKEN_FIELD]: 'token' },
      expect.any(Date),
    );
  });

  it('returns field errors and the typed values, and spends no try, for an invalid form', async () => {
    const result = await submitSupportRequest(
      idle,
      form({ email: 'nope', message: ' ' }),
    );

    expect(result).toMatchObject({
      status: 'invalid',
      values: { email: 'nope', name: 'Pat Smith' },
      errors: {
        email: expect.stringContaining('email') as string,
        message: expect.stringContaining('help') as string,
      },
    });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('counts the try against the forms limit for the caller address and this form', async () => {
    await submitSupportRequest(idle, form());

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      'forms',
      '203.0.113.9:contact',
    );
  });

  it('answers rate limited and writes nothing when the limit is reached', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
    });

    await expect(submitSupportRequest(idle, form())).resolves.toMatchObject({
      status: 'rate_limited',
      values: { name: 'Pat Smith' },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the write fails',
      () =>
        mocks.insertSupportRequest.mockRejectedValue(
          new TypeError('boom: pat@example.com'),
        ),
    ],
    [
      'the notice cannot be queued',
      () => mocks.enqueue.mockRejectedValue(new RangeError('boom')),
    ],
    [
      'the limiter fails',
      () => mocks.consumeRateLimit.mockRejectedValue(new Error('down')),
    ],
  ])('answers failed, keeping the form, when %s', async (_label, arrange) => {
    arrange();

    await expect(submitSupportRequest(idle, form())).resolves.toMatchObject({
      status: 'failed',
      values: { message: 'I was charged twice.' },
    });
  });

  it('logs only the error kind, never what the guest typed or the error text', async () => {
    mocks.insertSupportRequest.mockRejectedValue(
      new TypeError('insert failed for pat@example.com: I was charged twice.'),
    );

    await submitSupportRequest(idle, form());

    expect(mocks.logError).toHaveBeenCalledWith('support request failed', {
      errorKind: 'TypeError',
    });
  });
});
