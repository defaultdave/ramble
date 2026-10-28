import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { maxFilterValues, noFilters } from '@/lib/filters';
import { chooseBrowseDate } from './browse';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

// Behaviours under test, one per decision or branch:
// - a real day goes to the browse address with the day added and the other filters kept
// - a day that is not a real day, an oversize string, or an unbounded filter list is refused, never repaired

describe('chooseBrowseDate', () => {
  it('goes to the address with the day and keeps the other filters', async () => {
    await expect(
      chooseBrowseDate(
        { ...noFilters, categories: ['cooking'], neighborhoods: ['dumbo'] },
        '2026-11-07',
      ),
    ).rejects.toThrow(
      'redirect:/new-york/browse?category=cooking&neighborhood=dumbo&date=2026-11-07',
    );
  });

  it('replaces a day already chosen', async () => {
    await expect(
      chooseBrowseDate({ ...noFilters, date: '2026-11-07' }, '2026-11-08'),
    ).rejects.toThrow('redirect:/new-york/browse?date=2026-11-08');
  });

  it.each([
    ['a day that does not exist', noFilters, '2026-02-30'],
    ['text that is not a date', noFilters, 'tomorrow'],
    ['an oversize string', noFilters, `2026-11-07${'0'.repeat(500)}`],
    [
      'more categories than the bound',
      {
        ...noFilters,
        categories: Array.from(
          { length: maxFilterValues + 1 },
          (_, i) => `c${String(i)}`,
        ),
      },
      '2026-11-07',
    ],
    [
      'a slug that is not a slug',
      { ...noFilters, categories: ['NOT A SLUG'] },
      '2026-11-07',
    ],
  ])('refuses %s', async (_label, filters, date) => {
    await expect(chooseBrowseDate(filters, date)).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
