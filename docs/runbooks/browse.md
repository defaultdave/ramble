# Browse

How `/new-york/browse` works: the address grammar, what each part of it does, the cache, and what the guest sees when a read fails. The decisions are in ADR 0004 (URL as state, server-side filtering) and ADR 0001 (short-lived cache, extra combinations noindex).

## The address

`src/lib/filters.ts` is the one place the grammar lives. `parseFilters(searchParams)` reads it and `toQuery` / `browseHref` write it; nothing else builds a browse address.

| Parameter | Meaning | Rule |
|---|---|---|
| `category` | A category slug. Repeat it to match any of several | At most 8 values |
| `neighborhood` | A neighborhood slug. Repeat it to match any of several | At most 8 values |
| `date` | One day, `YYYY-MM-DD`, in the host's own calendar | A real calendar date, given once |
| `after` | The id of the last experience on the previous page | A uuid, given once |

`parseFilters` never repairs. An unknown parameter (`utm_source`, a stray `sort`) is ignored. A malformed value is dropped and its siblings are kept. A list with more than 8 raw values is dropped whole rather than cut to 8, and a single-value parameter given twice is dropped. Lists come back sorted and without repeats, so one state has one address and one cache entry. Every check on length runs before a pattern is applied, so a very long value costs one comparison.

A filter change always starts again from the first results: `hrefForFilters` leaves `after` out.

## Indexing

`isIndexable` is true only for the unfiltered first page. A category or neighborhood alone has its own indexable page (`/new-york/things-to-do/[category]`, `/new-york/neighborhoods/[neighborhood]`), so the same filter on browse would repeat it. Any filter, and any page after the first, sets `robots: noindex, follow` in `generateMetadata`. An attribution parameter alone changes nothing, because it is ignored by the parse.

## Reads

| Function | Where | Cache |
|---|---|---|
| `listBrowseExperiences(query, asOf)` | `src/server/db/browse.ts` | none; the data layer |
| `listBrowseDayRows(filters, asOf)` | same | none; returns the stored `local_date` values plus the start and zone of hand-entered sessions, not days |
| `getBrowseResults`, `getBrowseDates` | `src/server/browse.ts` | `'use cache'`, profile `browse` (revalidate 60 s, expire 10 min), tagged `catalog` and, for results, each listed experience |
| `getFilterOptions` | same | profile `catalog` |

`getBrowseDates` passes the rows from `listBrowseDayRows` to `browseDays` in `src/lib/browse.ts`, which decides the days: the data layer fetches, the lib decides.

The cache key includes `asOf`, the current time cut to the minute (`browseAsOf`), so guests inside one minute share an entry. A change that reaches an entry through `tagsForChange` is seen at once; a session added to an experience that is not on a cached page waits out the 60 seconds.

Paging is keyset, never `OFFSET`. Results are ordered by name and then id, a page is read as 13 rows and shown as 12 (`browsePageSize`), and `after` is the id of the last row shown. The next page is every row past that name and id. If the row behind `after` is hidden or gone, the read answers `cursor_not_found` and the page says so and links back to the first results.

Only `live` and `guide_only` experiences are read (the one guest-visibility condition in `src/server/db/catalog.ts`), and a live experience with no price option is left out because a card cannot show it.

A date matches an experience with a `scheduled` session that starts from `asOf` to 120 days ahead and falls on that day in the host's calendar: the stored `local_date`, or for a session entered by hand the day of `starts_at` in the session's `time_zone`.

## When a read fails

The three cached reads throw a `BrowseReadError` that carries the kind of the failure and nothing else, because Next.js logs whatever a cached function throws and a database error carries its query and values. Next.js logs that error with a digest, and the page logs only the digest, so the two lines can be matched. The page shows the heading and a danger alert ("We couldn't load experiences"), and a Try again button below it. The button is a GET form with the same address as hidden fields, so it works with no script. The page answers 200 in this state: the failure is inside a streamed region.

## What the e2e run covers

The e2e server has no database. `e2e/browse.spec.ts` covers the robots rule, the grammar (dropped values keep the page indexable), the error state, and Try again. The results grid, the chips, Show more, and the calendar days are covered by the component tests, the stories, and `tests/db/browse.db.test.ts`.
