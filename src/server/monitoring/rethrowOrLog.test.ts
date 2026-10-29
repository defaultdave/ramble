import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rethrowOrLog } from './rethrowOrLog';

// Behaviours under test, one per decision, branch or risk:
// - a framework control-flow error is rethrown and nothing is logged
// - an error with a digest is logged with the message, the digest and its kind
// - an error without a digest is logged with its kind and an undefined digest
// - the kind is the error name, never its message, so a query or its values stay out of the log
// - a thrown value that is not an Error is logged with the kind unknown

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({ logger }));

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('rethrowOrLog', () => {
  beforeEach(() => {
    logger.error.mockClear();
  });

  it('rethrows a framework control-flow error and logs nothing', () => {
    const control = thrownBy(() => {
      notFound();
    });

    expect(() => {
      rethrowOrLog('Page failed', control);
    }).toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs the message, the digest and the kind of an error with a digest', () => {
    const error = Object.assign(new TypeError('boom'), { digest: '1234567' });

    rethrowOrLog('Page failed', error);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Page failed', {
      digest: '1234567',
      kind: 'TypeError',
    });
  });

  it('logs the kind with an undefined digest when the error has none', () => {
    rethrowOrLog('Page failed', new RangeError('boom'));

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Page failed', {
      digest: undefined,
      kind: 'RangeError',
    });
  });

  it('leaves the message of the error out of the log', () => {
    rethrowOrLog(
      'Page failed',
      new Error('Failed query: select ... params: secret-slug'),
    );

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'secret-slug',
    );
  });

  it.each([['a string'], [null], [undefined], [{ name: 'Sneaky' }]])(
    'logs the kind unknown for a thrown value that is not an Error (%j)',
    (thrown) => {
      rethrowOrLog('Page failed', thrown);

      expect(logger.error).toHaveBeenCalledExactlyOnceWith('Page failed', {
        digest: undefined,
        kind: 'unknown',
      });
    },
  );
});
