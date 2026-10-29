import { describe, expect, it } from 'vitest';
import { bearerToken } from './http';

describe('bearerToken', () => {
  it.each([
    ['Bearer abc123', 'abc123'],
    ['bearer abc123', 'abc123'],
    ['BEARER abc123', 'abc123'],
    ['Bearer  abc', null],
    ['Basic abc123', null],
    ['Bearer', null],
    ['Bearer a b', null],
    [`Bearer ${'a'.repeat(256)}`, 'a'.repeat(256)],
    [`Bearer ${'a'.repeat(257)}`, null],
    ['', null],
    [null, null],
  ])('%j reads as %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });
});
