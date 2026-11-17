import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuardedFormState } from '@/lib/formFields';

const mocks = vi.hoisted(() => ({
  headerGet: vi.fn(),
  checkFormGuard: vi.fn(),
  consumeRateLimit: vi.fn(),
  transaction: vi.fn(),
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
vi.mock('@/server/jobs/enqueue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: mocks.logError },
}));

import { runGuardedForm, type GuardedFormSpec } from './guardedForm';

// Behaviours under test, one per decision, branch or risk (the contact and private session action
// tests cover each form's own fields and notice):
// - the guard runs before the form is read: a refusal never reaches parse, and answers as a success does
// - an expired form keeps what was typed
// - a refusal from parse is returned as given and costs no rate-limit try
// - the try is counted for the caller address and the form name; a reached limit writes nothing
// - the request and its notice go in one transaction, with a dedupe key from the prefix and stored id
// - a failed write answers failed, and the log holds the error kind and no typed value

type State = GuardedFormState<{ note: string }, { note?: string }>;
type Stored = { id: string };

const tx = { marker: 'tx' };
const values = { note: 'typed text' };
const stored: Stored = { id: 'req-1' };

const spec = (
  over: Partial<
    GuardedFormSpec<typeof values, { note?: string }, string, Stored>
  > = {},
) =>
  ({
    formName: 'demo',
    dedupePrefix: 'demo-request',
    failureLog: 'demo request failed',
    formData: new FormData(),
    values,
    parse: () => ({ ok: true, data: 'parsed' }),
    insert: vi.fn().mockResolvedValue(stored),
    notice: () => ({ subject: 's', fields: [{ label: 'l', value: 'v' }] }),
    ...over,
  }) satisfies GuardedFormSpec<
    typeof values,
    { note?: string },
    string,
    Stored
  >;

const run = (over: Parameters<typeof spec>[0] = {}): Promise<State> =>
  runGuardedForm(spec(over));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headerGet.mockReturnValue('203.0.113.9, 10.0.0.1');
  mocks.checkFormGuard.mockReturnValue({ ok: true });
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
  mocks.transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(tx),
  );
  mocks.enqueue.mockResolvedValue({ id: 'job' });
});

describe('runGuardedForm', () => {
  it('answers sent without reading the form when the guard refuses', async () => {
    mocks.checkFormGuard.mockReturnValue({ ok: false, reason: 'too_fast' });
    const parse = vi.fn();

    await expect(run({ parse })).resolves.toEqual({ status: 'sent' });

    expect(parse).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it('asks for a reload on an expired form and keeps what was typed', async () => {
    mocks.checkFormGuard.mockReturnValue({ ok: false, reason: 'expired' });

    await expect(run()).resolves.toEqual({ status: 'expired', values });
  });

  it.each([
    ['invalid', { status: 'invalid', values, errors: { note: 'Say it.' } }],
    ['failed', { status: 'failed', values }],
  ] as const)(
    'returns the %s reply from parse and spends no try',
    async (_name, state) => {
      await expect(
        run({ parse: () => ({ ok: false, state }) }),
      ).resolves.toEqual(state);

      expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it('counts the try for the caller address and the form name', async () => {
    await run();

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      'forms',
      '203.0.113.9:demo',
    );
  });

  it('answers rate limited and writes nothing when the limit is reached', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(run()).resolves.toEqual({ status: 'rate_limited', values });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('writes the request and queues its notice in one transaction', async () => {
    const insert = vi.fn().mockResolvedValue(stored);

    await expect(run({ insert })).resolves.toEqual({ status: 'sent' });

    expect(insert).toHaveBeenCalledWith(tx, 'parsed');
    expect(mocks.enqueue).toHaveBeenCalledWith(tx, {
      kind: 'ops-notice',
      payload: { subject: 's', fields: [{ label: 'l', value: 'v' }] },
      dedupeKey: 'demo-request:req-1',
    });
  });

  it('answers failed and logs the error kind only when the write fails', async () => {
    const insert = vi.fn().mockRejectedValue(new TypeError('typed text'));

    await expect(run({ insert })).resolves.toEqual({
      status: 'failed',
      values,
    });

    expect(mocks.logError).toHaveBeenCalledWith('demo request failed', {
      errorKind: expect.any(String) as string,
    });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(
      'typed text',
    );
  });
});
