import { describe, expect, it } from 'vitest';
import { PortError } from './portError';

describe('PortError', () => {
  it('uses the code as the message when none is given', () => {
    const error = new PortError('ThingError', 'not_found');

    expect(error).toMatchObject({
      name: 'ThingError',
      code: 'not_found',
      message: 'not_found',
    });
    expect(error.cause).toBeUndefined();
  });

  it('keeps the message and the cause it is given', () => {
    const cause = new Error('socket closed');
    const error = new PortError(
      'ThingError',
      'provider_unavailable',
      'later',
      cause,
    );

    expect(error.message).toBe('later');
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(Error);
  });
});
