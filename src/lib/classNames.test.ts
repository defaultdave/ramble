import { describe, expect, it } from 'vitest';
import { classNames } from './classNames';

describe('classNames', () => {
  it('joins the names that are present', () => {
    expect(classNames('a', undefined, false, null, 'b')).toBe('a b');
  });

  it('is empty when nothing is present', () => {
    expect(classNames(undefined, false)).toBe('');
  });
});
