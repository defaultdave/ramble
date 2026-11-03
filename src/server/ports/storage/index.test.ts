import { describe, expect, it } from 'vitest';
import { isPermanentFailure, permanentFailure } from '@/lib/jobs';
import { StorageError, type StorageErrorCode } from '.';

// Behaviours under test:
// - a StorageError sets the drain's marker exactly when its code is permanent
// - the drain's reading of the marker agrees, so an unsupported store dead-letters at once and the rest retry

describe('StorageError permanent marker', () => {
  it.each([
    ['unsupported', true],
    ['invalid_input', false],
    ['not_found', false],
    ['already_exists', false],
    ['provider_unavailable', false],
  ] as [StorageErrorCode, boolean][])(
    '%s sets the marker to %s',
    (code, expected) => {
      const error = new StorageError(code);

      expect(error[permanentFailure]).toBe(expected);
      expect(error.permanent).toBe(expected);
      expect(isPermanentFailure(error)).toBe(expected);
    },
  );
});
