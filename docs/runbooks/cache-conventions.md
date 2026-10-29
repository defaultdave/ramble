# Cache conventions

How cached code is written in Ramble, and what happens when the cache fails. The decisions are in ADR 0001 (amendment of 2026-10-18); the evidence is the [Cache Components spike](../adr/research/u-008a-u-009-cache-components-spike.md).

## Writing a cached function

- Put `'use cache'` inside the function, never at the top of the file.
- Call `cacheLife('<profile>')` with one of the names in `src/lib/cacheProfiles.ts`. `next.config.ts` registers the same object. A new profile is a line in that file, with the reason in a comment.
- Call `cacheTag(...)` with builders from `src/lib/cacheTags.ts` (`tags.experience(id)`), never a string typed in place.
- Take every input as an argument. A cached function never reads cookies, headers, the caller, or a token (rule B14).
- A page that lists experiences (Picks, the gift guide, a home module) also tags itself with `tags.experience(id)` for each entry it shows, so an experience change reaches it.

`tests/cache/conventions.test.ts` reads every file under `src/` and fails on a cached function that breaks these rules.

## Invalidating

Describe what changed as a `CacheChange` and let `tagsForChange()` choose the tags. Adding a kind of change means adding one case there and one row to its test.

| Where the change happens | Call | Effect |
|---|---|---|
| A Server Action (the ops publish flow, suspend, booking changes) | `updateTagsForChanges(changes)` | The next request is fresh |
| A webhook or a job | `revalidateTagsForChanges(changes)` | One more stale response, then fresh |

Do not build a correctness rule on `revalidateTag(tag, { expire: 0 })` serving fresh data. On a prerendered page the spike saw one older page served after it.

## Runtime cache reads

`'use cache: remote'` is for short-lived shared reads such as spaces left. Keep the remote function private to its file and export a function that calls it through `readRemoteOrFallback(remote, fallback)` from `src/server/cache/remote.ts`. The convention test rejects an exported, default-exported, or method remote function, and any use of a remote function outside the first argument of `readRemoteOrFallback`. The fallback is a direct Postgres read, which is authoritative at reserve (ADR 0002).

The one such read today is `getSpacesLeft(sessionId)` in `src/server/spacesLeft.ts` (profile `spacesLeft`, tag `session:<id>`). It answers `null` for an ID that is no guid (no cache key is made) and for a session guests cannot see, and a number as it is (zero or less reads as sold out). Every write that changes a session's spaces invalidates its tag: a hold placed, released, or superseded and a saved capacity edit call `updateTagsForChanges` (Server Actions only), and the hold upkeep job calls `revalidateTagsForChanges` after it releases holds. A deadline passing changes the count with no write, so the entry's few seconds of life cover that. Valid but unknown session IDs are cached as `null` for up to the profile's `expire` (60 seconds).

## Degraded modes

| Failure | What the guest sees | Where it is handled |
|---|---|---|
| Revalidation fails | The last cached page keeps serving | Framework behavior |
| Runtime cache unreachable | The read comes from Postgres, one `console.error` line per failed read | `readRemoteOrFallback` |
| Runtime cache and Postgres both fail | The error reaches the nearest error boundary; the cached shell around it still returns 200 | The availability island shows its "Check availability" button (built with the experience page units) |
| Checkout while bookings are paused | The maintenance state | Ops switches (ADR 0002) |

## Guest routes send no cookies

`e2e/guest-cookies.spec.ts` loads every guest route in the `pnpm e2e` job and fails on a `Set-Cookie` header, a `Vary: Cookie` header, or any cookie in the browser. A guest route that needs a cookie (a form with a token, for example) must be moved out of the guest route group first.
