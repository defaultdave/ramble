'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  BrowseFiltersSchema,
  hrefForFilters,
  withDate,
  type BrowseFilters,
} from '@/lib/filters';
import { IsoDateSchema } from '@/lib/sessions';

// The length is checked before the date rule walks the string.
const ChosenDateSchema = z.string().max(10).pipe(IsoDateSchema);

/**
 * The calendar's answer: goes to the browse address with the day added to the filters the page
 * was showing. Both arrive from the browser, so both are parsed, and a bad one is refused.
 */
// A Server Action is always async, and this one has nothing to wait for.
// eslint-disable-next-line @typescript-eslint/require-await
export async function chooseBrowseDate(
  filters: BrowseFilters,
  date: string,
): Promise<void> {
  const parsed = z
    .object({ filters: BrowseFiltersSchema, date: ChosenDateSchema })
    .parse({ filters, date });
  redirect(hrefForFilters(withDate(parsed.filters, parsed.date)));
}
