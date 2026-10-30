import { describe, expect, it } from 'vitest';
import { editorialLimits } from './editorial';
import { cardLookupLimit, idListSchema, picksCandidates } from './idLookup';
import { homeLimits } from './pages/home';
import { photoLimits } from './photos';

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('cardLookupLimit', () => {
  it('is the home modules times the Picks candidates of each', () => {
    expect(cardLookupLimit).toBe(editorialLimits.homeModules * picksCandidates);
  });

  it('is the one bound the home read and the cover read share', () => {
    expect(homeLimits.maxCardIds).toBe(cardLookupLimit);
    expect(homeLimits.picksCandidates).toBe(picksCandidates);
    expect(photoLimits.maxCoverLookups).toBe(cardLookupLimit);
  });
});

describe('idListSchema', () => {
  const schema = idListSchema(cardLookupLimit);

  it('accepts exactly the bound and returns the IDs unchanged', () => {
    const ids = Array.from({ length: cardLookupLimit }, (_, n) => id(n));
    expect(schema.parse(ids)).toEqual(ids);
  });

  it('refuses one past the bound', () => {
    const ids = Array.from({ length: cardLookupLimit + 1 }, (_, n) => id(n));
    expect(schema.safeParse(ids).success).toBe(false);
  });

  it('refuses a list past the bound without checking its IDs', () => {
    const result = schema.safeParse(
      Array.from({ length: cardLookupLimit + 1 }, () => 42),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.code).toBe('too_big');
  });

  it.each([
    ['an ID that is not a uuid', ['not-a-uuid']],
    ['an empty ID', ['']],
    ['a value that is not a string', [42]],
  ])('refuses %s', (_name, ids) => {
    expect(schema.safeParse(ids).success).toBe(false);
  });

  it('takes an empty list and a capital-letter uuid as the current schemas do', () => {
    expect(schema.parse([])).toEqual([]);
    const upper = id(255).toUpperCase();
    expect(schema.parse([upper])).toEqual([upper]);
  });
});
