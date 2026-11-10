import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from '@/lib/formGuard';
import type { PrivateSessionFormState } from '@/lib/privateSession';

const mocks = vi.hoisted(() => ({
  headerGet: vi.fn(),
  checkFormGuard: vi.fn(),
  consumeRateLimit: vi.fn(),
  transaction: vi.fn(),
  insertPrivateRequest: vi.fn(),
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
vi.mock('@/server/db/privateRequests', () => ({
  insertPrivateRequest: mocks.insertPrivateRequest,
}));
vi.mock('@/server/jobs/enqueue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: mocks.logError },
}));

import { requestPrivateSession } from './privateSession';

// Behaviours under test, one per decision, branch or risk:
// - a valid form writes the request and queues the ops notice in one transaction, and says sent
// - the notice carries the labelled fields and a dedupe key built from the request id
// - a guard refusal (honeypot, forged or too-fast token) gets the reply a success gets and writes and counts nothing
// - an expired form asks for a reload and keeps what was typed
// - a form that fails validation (including a past date) returns its field errors and values, and costs no rate-limit try
// - a missing or malformed experience id is refused as failed, and writes nothing
// - the rate limit is per address and form, and a refusal writes nothing
// - a failed write or a failed limiter answers failed, and the log holds the error kind and nothing the guest typed

const experienceId = '3F2504E0-4F89-41D3-9A0C-0305E82C3302';

const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields = {
    experienceId,
    date: '2099-01-15',
    groupSize: '12',
    budget: '$1,200',
    name: 'Pat Smith',
    email: 'Pat@Example.com',
    message: 'A birthday.',
    [FORM_TOKEN_FIELD]: 'token',
    [HONEYPOT_FIELD]: '',
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const idle: PrivateSessionFormState = { status: 'idle' };
const tx = { marker: 'tx' };
const stored = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  createdAt: new Date('2026-11-10T12:00:00Z'),
  experienceName: 'Pasta night',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headerGet.mockReturnValue('203.0.113.9, 10.0.0.1');
  mocks.checkFormGuard.mockReturnValue({ ok: true });
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
  mocks.transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(tx),
  );
  mocks.insertPrivateRequest.mockResolvedValue(stored);
  mocks.enqueue.mockResolvedValue({ id: 'job' });
});

describe('the requestPrivateSession action', () => {
  it('writes the request and queues the ops notice in one transaction', async () => {
    await expect(requestPrivateSession(idle, form())).resolves.toEqual({
      status: 'sent',
    });

    expect(mocks.insertPrivateRequest).toHaveBeenCalledWith(
      tx,
      experienceId.toLowerCase(),
      {
        date: '2099-01-15',
        groupSize: 12,
        budgetMinor: 120_000,
        name: 'Pat Smith',
        email: 'pat@example.com',
        message: 'A birthday.',
      },
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, {
      kind: 'ops-notice',
      payload: {
        subject: 'Private session request: Pasta night',
        fields: [
          { label: 'Experience', value: 'Pasta night' },
          { label: 'Name', value: 'Pat Smith' },
          { label: 'Email', value: 'pat@example.com' },
          { label: 'Date', value: '2099-01-15' },
          { label: 'Group size', value: '12' },
          { label: 'Budget', value: '$1,200.00' },
          { label: 'Message', value: 'A birthday.' },
          { label: 'Request ID', value: stored.id },
          { label: 'Received', value: '2026-11-10T12:00:00.000Z' },
        ],
      },
      dedupeKey: `private-request:${stored.id}`,
    });
  });

  it('takes a request with no message', async () => {
    await requestPrivateSession(idle, form({ message: '' }));

    expect(mocks.insertPrivateRequest).toHaveBeenCalledWith(
      tx,
      expect.any(String),
      expect.objectContaining({ message: null }),
    );
  });

  it.each(['honeypot_filled', 'too_fast', 'invalid_token'])(
    'answers sent and does nothing else when the guard says %s',
    async (reason) => {
      mocks.checkFormGuard.mockReturnValue({ ok: false, reason });

      await expect(requestPrivateSession(idle, form())).resolves.toEqual({
        status: 'sent',
      });

      expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it('asks for a reload when the form expired, and keeps what was typed', async () => {
    mocks.checkFormGuard.mockReturnValue({ ok: false, reason: 'expired' });

    await expect(requestPrivateSession(idle, form())).resolves.toEqual({
      status: 'expired',
      values: {
        date: '2099-01-15',
        groupSize: '12',
        budget: '$1,200',
        name: 'Pat Smith',
        email: 'Pat@Example.com',
        message: 'A birthday.',
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('hands the guard the honeypot as an absent value when the form lacks it', async () => {
    const data = form();
    data.delete(HONEYPOT_FIELD);

    await requestPrivateSession(idle, data);

    expect(mocks.checkFormGuard).toHaveBeenCalledWith(
      { [HONEYPOT_FIELD]: undefined, [FORM_TOKEN_FIELD]: 'token' },
      expect.any(Date),
    );
  });

  it.each([
    ['a past date', { date: '2020-01-01' }, 'date'],
    ['a bad budget', { budget: 'lots' }, 'budget'],
    ['a group of none', { groupSize: '0' }, 'groupSize'],
  ])(
    'returns field errors and the typed values, and spends no try, for %s',
    async (_label, over, field) => {
      const result = await requestPrivateSession(idle, form(over));

      expect(result).toMatchObject({
        status: 'invalid',
        values: { name: 'Pat Smith', ...over },
        errors: { [field]: expect.any(String) as string },
      });
      expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', undefined],
    ['not an id', 'pasta'],
  ])(
    'answers failed and writes nothing when the experience id is %s',
    async (_label, value) => {
      const data = form();
      if (value === undefined) data.delete('experienceId');
      else data.set('experienceId', value);

      await expect(requestPrivateSession(idle, data)).resolves.toMatchObject({
        status: 'failed',
        values: { name: 'Pat Smith' },
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it('counts the try against the forms limit for the caller address and this form', async () => {
    await requestPrivateSession(idle, form());

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      'forms',
      '203.0.113.9:private-session',
    );
  });

  it('answers rate limited and writes nothing when the limit is reached', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
    });

    await expect(requestPrivateSession(idle, form())).resolves.toMatchObject({
      status: 'rate_limited',
      values: { name: 'Pat Smith' },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the write fails',
      () =>
        mocks.insertPrivateRequest.mockRejectedValue(
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

    await expect(requestPrivateSession(idle, form())).resolves.toMatchObject({
      status: 'failed',
      values: { message: 'A birthday.' },
    });
  });

  it('logs only the error kind, never what the guest typed or the error text', async () => {
    mocks.insertPrivateRequest.mockRejectedValue(
      new TypeError('insert failed for pat@example.com: A birthday.'),
    );

    await requestPrivateSession(idle, form());

    expect(mocks.logError).toHaveBeenCalledWith(
      'private session request failed',
      { errorKind: 'TypeError' },
    );
  });
});
