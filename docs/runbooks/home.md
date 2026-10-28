# Home page

How `/` is built from the modules staff arrange, what each module shows and when it hides, how it is cached, and what the guest sees when a read fails. The decisions are in ADR 0001 (Cache Components) and the cache rules in [cache-conventions.md](cache-conventions.md). The editorial store is U-018's: `home_modules`, `collections`, and the settings row.

## The modules

`listHomeModules()` returns the enabled modules in position order, leaving out one whose collection is still a draft. `buildHomePage` in `src/lib/home.ts` turns them into what the page shows, and leaves out a module that has nothing to show. A module with nothing to show is hidden whole, never drawn empty.

| Module | Shows | Copy comes from | Hidden when |
|---|---|---|---|
| `hero_search` | The one h1, the copy under it, and a search: neighborhood and day | The module's heading and body; the default copy in `homeCopy` when it has none | Never |
| `category_rail` | Every category as a link to `/new-york/browse?category=<slug>` | The module's heading | There is no category |
| `picks` | The Pick's first three cards, its title and summary, and "See all N picks" to `/picks/<slug>` | The module's heading, else the Pick's title | The module has no collection, the collection is not published, or none of its first 12 entries can be a card |
| `gift_guide` | The module's copy, a link to `/gifts`, and the sponsor line | The module's heading and body | Gifts are switched off in settings |
| `this_week` | Up to four experiences with a bookable session in the next seven days, soonest first | The module's heading | No session is open |
| `reassurance` | Three facts: cancellation, confirmation, payment | `homeCopy.reassurance` | Never |

The first `picks` module that shows carries the id `picks`, which the header and footer link to (`/#picks`).

A card is left out, never repaired, when it cannot be shown: a bookable experience with no price, or a guide entry with no link out. A card shows its experience's cover photo (see "Cover photos" below); an experience with no photo keeps the empty frame, the missing-image state the `Card` already has.

The page has no hero when staff switch it off. Then a visually hidden h1 stands in, so the page always has one. With no module at all, the page says so and links to browse.

### The search

The hero's search is a plain GET form to `/new-york/browse`. It sends `neighborhood` (a slug) and `date` (`YYYY-MM-DD`) in the address grammar of `docs/runbooks/browse.md`, and nothing else: the grammar has no party size, so the design's Guests field is not built. A field left empty is sent empty, and the browse page drops an empty value.

## Reads and cache

| Function | File | Profile | Tags |
|---|---|---|---|
| `getHomeContent()` | `src/server/home.ts` | `editorial` | `home`, `catalog`, `experience:<id>` for each card |
| `getThisWeek(asOf)` | `src/server/home.ts` | `browse` | `catalog`, `experience:<id>` for each listed experience |
| `getCachedGuestSettings()` | `src/server/siteSettings.ts` | `settings` | `settings` |

`asOf` is the current time cut to the minute (`homeAsOf`), so guests inside one minute share one entry. Saving settings invalidates `settings`, which is how a new banner reaches every guest page; publishing a module, a Pick, or a category reaches the home reads through `home` and `catalog`.

The page and the banner read after `connection()`, inside `<Suspense>`. The build therefore never reads the database (CI builds with none), and a prefetch stops at the skeleton. The cached reads still hold the data between requests.

The reads are `listHomeExperiences` and `listThisWeekSessions` in `src/server/db/home.ts`. Both are bounded (`homeLimits`) and read guest-visible rows only, so they take no caller.

## Cover photos

The home cards and the browse cards show the same photo for one experience: the one with the lowest position in its gallery. `buildHomePage` builds the cards with no image, then the page reads the covers of the cards it kept and sets them (`homeCardIds`, `withHomeCovers` in `src/lib/home.ts`; `browseCardIds`, `withBrowseCovers` in `src/lib/browse.ts`). The read is `getCoverPhotos(ids)` in `src/server/coverPhotos.ts`: `'use cache'`, profile `catalog`, tagged `experience:<id>` for every ID it was asked about, so a photo added to an experience reaches every card that lists it. Pass the IDs through `coverLookupIds` so two pages that list the same experiences in another order share one entry.

`listGuestCoverPhotos` (`src/server/db/photos.ts`) takes at most `photoLimits.maxCoverLookups` IDs (240, the most the home page can list) and returns one row per experience, guest-visible experiences only. A longer or malformed list is refused, never cut. A failed cover read is handled like any other failed read of the page: the error state, and only the digest is logged.

`Photo` (`src/components/Photo`) draws the image with `next/image`, filling its frame, with the blur placeholder. A decorative photo has an empty alt. The cards ask for `384px` from the tablet width and `100vw` below it; the horizontal card asks for `168px`.

## The site banner

`GuestBanner` reads the cached settings above the header on every guest page and shows `bannerText` when it is not blank. A failed read leaves the banner out and logs the digest; the switches that matter (paused bookings, checkout maintenance) are enforced where they act, not by this notice.

## When a read fails

A cached read throws only the kind of the failure (`CachedReadError`), because Next.js logs whatever a cached function throws and a database error carries its query and values. The page logs the digest of that error, shows the heading and a danger alert ("We couldn't load the home page"), and a Try again button. The button is a GET form to `/`, so it works with no script. The page answers 200 in this state: the failure is inside a streamed region.

## What the e2e run covers

The e2e server has no database. `e2e/home.spec.ts` covers the error state and its retry, the skip link, the phone menu, the footer, and that `/` and `/help` do not scroll sideways at 320px. The modules are covered by the component tests, the stories (every module on a phone and, light only, on a desktop), and `tests/db/home.db.test.ts`.
