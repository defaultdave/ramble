import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
const captureAlert = vi.hoisted(() => vi.fn());

vi.mock('./logger', () => ({ logger: log }));
vi.mock('./sentry', () => ({ captureAlert }));

const { alerts } = await import('./alerts');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('alerts.raise', () => {
  it('logs an error line and opens a Sentry issue with the runbook link', () => {
    alerts.raise('payment-mismatch', 'critical', 'order:ord_1', {
      orderId: 'ord_1',
    });

    expect(log.error).toHaveBeenCalledWith(
      'alert payment-mismatch: order:ord_1',
      {
        alert: true,
        kind: 'payment-mismatch',
        severity: 'critical',
        dedupeKey: 'order:ord_1',
        runbook:
          'https://github.com/defaultdave/ramble/blob/main/docs/runbooks/payment-mismatch.md',
        context: { orderId: 'ord_1' },
      },
    );
    expect(captureAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'payment-mismatch',
        level: 'fatal',
        fingerprint: ['payment-mismatch', 'order:ord_1'],
      }),
      { orderId: 'ord_1' },
    );
  });

  it('logs a warning as a warning, and an error as an error', () => {
    alerts.raise('slow-email', 'warning', 'k');
    alerts.raise('refund-failed', 'error', 'k');

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('defaults the context to an empty object', () => {
    alerts.raise('slow-email', 'warning', 'k');

    expect(captureAlert).toHaveBeenCalledWith(expect.anything(), {});
  });

  it.each([
    ['kind', ['Bad Kind', 'error', 'k']],
    ['severity', ['ab', 'urgent', 'k']],
    ['dedupe key', ['ab', 'error', 'has space']],
  ] as const)(
    'throws on a bad %s before logging or sending anything',
    (_name, args) => {
      expect(() => {
        alerts.raise(...(args as unknown as Parameters<typeof alerts.raise>));
      }).toThrow();
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
      expect(captureAlert).not.toHaveBeenCalled();
    },
  );

  it('does not throw when Sentry fails, and logs that it failed', () => {
    captureAlert.mockImplementation(() => {
      throw new Error('sentry down');
    });

    expect(() => {
      alerts.raise('refund-failed', 'error', 'k');
    }).not.toThrow();
    expect(log.error).toHaveBeenLastCalledWith(
      'alert could not be sent to Sentry',
      expect.objectContaining({ kind: 'refund-failed' }),
    );
  });
});
