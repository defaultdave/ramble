import { describe, expect, it } from 'vitest';
import { secureEqual, sha256Hex } from './hash';

// Behaviours under test, one per branch:
// - sha256Hex returns the known lowercase hex digest for the empty string, 'abc' and a multibyte string (UTF-8 bytes)
// - equal strings match, including non-ASCII ones
// - a different string, a prefix, a longer string, and an empty string each fail without throwing
// - strings of equal character count but unequal byte length (a multibyte letter for a plain one) take the unequal-length path and fail

describe('secureEqual', () => {
  it.each(['secret', 'clé secrète', ''])('matches %j with itself', (value) => {
    expect(secureEqual(value, value)).toBe(true);
  });

  it.each([
    ['a different string', 'secret', 'Secret'],
    ['a prefix', 'secret', 'secre'],
    ['a longer string', 'secret', 'secret!'],
    ['empty against a value', 'secret', ''],
    ['a value against empty', '', 'secret'],
    ['equal character count, unequal byte length', 'cle', 'clé'],
    ['equal byte length, different bytes', 'ab', 'é'],
  ])('refuses %s', (_label, a, b) => {
    expect(secureEqual(a, b)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['é', '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
  ])('hashes %j', (input, digest) => {
    expect(sha256Hex(input)).toBe(digest);
  });
});
