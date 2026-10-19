# Caching and performance infrastructure

Researched 2026-10-18 for the Ramble industry-gap review.

Basis labels: **[inferred]** is my arithmetic or reading from documented facts. **[unconfirmed]** could not be verified on a primary page. Every link was read on 2026-10-18; the Sources table gives each page's own "last updated" date where it shows one. Effort scale (my estimate, not measured): S is under a day of build time, M is 1 to 3 days, L is more than 3.

Scope note: this builds on ADRs [0001](../../0001-framework-and-rendering.md), [0002](../../0002-data-and-holds.md), [0004](../../0004-search-and-map.md), [0005](../../0005-styling-and-design-system.md), [0006](../../0006-testing-and-quality-gates.md), [0007](../../0007-hosting-and-ci.md), [0008](../../0008-seed-content.md). It does not reopen Vercel, Cache Components, Neon, or Drizzle.

## Summary

- The platform choices are sound and the gaps are operating detail. ADR 0001 picks Cache Components but sets no lifetimes, tag map, cache-safe response rules, or deploy behavior. ADR 0002 picks Neon but sets no connection policy or compute floor. ADR 0005 and 0008 say "object storage" and "`next/image`" but no photo ingest rules. Of the 17 capabilities below, 1 is covered, 10 are partial, 6 are gaps. None is large; most are S or M.
- The newsletter spike (PRD-70) does not need Redis. `use cache` on its own keeps entries in per-instance memory that serverless does not carry between requests ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache#runtime-caching-considerations)). `use cache: remote` stores them in Vercel's Runtime Cache, shared across instances ([Vercel](https://vercel.com/docs/caching/runtime-cache)). A 5 to 10 second lifetime on "spaces left" takes about 14 uncached queries a second at peak down to about 1 or 2 [inferred]. Postgres stays the authority for holds.
- Every deploy starts cold. The `use cache` key includes the build ID, so entries, remote ones too, do not survive a deploy ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote#persistence-across-deploys)). Each deployment also gets its own ISR cache ([Vercel](https://vercel.com/docs/incremental-static-regeneration)). Newsletter days need a deploy freeze, `generateStaticParams` for known pages, and a post-deploy warm script.
- Attribution links may defeat the CDN. Vercel documents query strings as ignored only for static files ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#cache-keys)). A per-subscriber identifier in the query string (PRD-58) could give every subscriber their own cache entry on the highest-volume traffic source. Test in the walking skeleton; keep the identifier out of the query string.
- ADR 0006's k6 test against a Vercel preview collides with Vercel's policy. The policy page says load testing is "only permitted on Enterprise plans" ([Vercel](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments)), and unannounced tests get their source IPs blocked. Run the PRD-70 test against a self-hosted `next start` of the same build plus a Neon branch, and ask Vercel before any Vercel-side run.
- Images: `next/image` on Vercel with originals in Vercel Blob is the right real-job pick (about $1 to fill the optimized-image cache once [inferred]); a hosted image CDN at $25 to $99 a month buys nothing Ramble needs. The demo hits Hobby's 5,000 transformations a month if the 400-experience fixture uses distinct photos or AVIF is on. The real gap is ingest: validation, re-encode, EXIF stripping, blur placeholders, immutable URLs.
- Database: send app traffic through Neon's pooled host, use the HTTP driver for single-statement reads and the WebSocket pool only for the hold transaction. On Neon Free (100 CU-hours), a synthetic booking every 5 minutes keeps compute awake and spends the month's allowance in about 16 days [inferred, assumes a 0.25 CU floor]. The real job turns scale-to-zero off on Launch, about $19 to $39 a month [inferred].
- Hobby limits the demo will hit first: 1M CDN requests (one PRD-70-sized run with assets), 5,000 image transformations, 10,000 Speed Insights events, 100 deployments a day, 12 hours of observability data, no Skew Protection, no System Bypass rules. The real job's infrastructure for this layer is on the order of $100 a month [inferred], small against C-01's $8k retainer.

## PRD-70 arithmetic used below

All shapes are assumptions until Q-20 is answered. I used the higher PRD-70 estimate.

| Quantity | Value | Basis |
|---|---|---|
| Visitors per send | 12,500 in 3 hours | PRD-70 |
| Average arrival | 1.2 a second | 12,500 / 10,800 s |
| Peak arrival | 6.9 a second | half the visitors in the first 15 minutes [assumed shape] |
| Page views per visit | 3 | assumption; conversion unknown (A-02) |
| Peak page views | about 21 a second | 6.9 x 3 |
| Peak experience-page views | about 14 a second | 2 of 3 views [assumption] |
| Uncached "spaces left" queries at peak | about 14 a second | one per experience-page view |
| With a 10 s remote cache and 10 featured experiences | about 1 a second | 10 keys / 10 s |
| CDN requests per page view | about 35 | HTML, JS and CSS chunks, images, fonts, beacon [assumption; measure at the walking skeleton] |
| CDN requests per send | about 1.3M | 12,500 x 3 x 35 |
| Document-only requests per send (k6) | 37,500 | 12,500 x 3 |

## Capability table

Coverage names the ADR. "Real-job pick" assumes Vercel Pro and Neon Launch (ADR 0007).

| Capability | Why Ramble needs it | Coverage today | Real-job pick | Free demo option and its limits | Effort | When |
|---|---|---|---|---|---|---|
| 1. Cacheable HTML shells and cache-safe responses | PRD-65, PRD-68, PRD-70. Vercel's CDN does not cache a response that sets a cookie, varies on `Cookie`, or is `private` or `no-store` ([Vercel](https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria), [change 2026-09-30](https://vercel.com/changelog/vary-cookie-responses-no-longer-cached)) | ADR 0001: partial (model chosen; no lifetimes, cookie, or query-string rules) | Vercel's CDN alone (no CDN in front, [Vercel advises against](https://vercel.com/kb/guide/why-running-another-cdn-on-top-of-vercel-is-not-recommended)); explicit `cacheLife` on every `use cache`; `generateStaticParams` for known pages; a CI header test | Same on Hobby. Limits: 1M CDN requests and 100 GB data transfer a month ([Vercel](https://vercel.com/docs/plans/hobby)) | S | launch-critical |
| 2. Hot-read cache for "spaces left" | PRD-70, PRD-09, PRD-21, PRD-16 | ADR 0001 and 0002: partial (0001 says "short-lived cached results"; 0002 defers harder caching to Q-20) | `use cache: remote` (Vercel Runtime Cache), 5 to 10 s lifetime, Postgres authoritative at reserve | Same code on Hobby. Runtime Cache allowance is not listed on the Hobby page [unconfirmed]; on a miss the read falls through to Postgres, so the demo still works | S | launch-critical |
| 3. Catalog and browse caching | PRD-02, PRD-05, PRD-65, PRD-68 | ADR 0001 and 0004: partial | Two remote entries (catalog index, per-week session index) filtered in memory; prerender category, neighborhood, and Picks pages | Same. Each Runtime Cache item is capped at 2 MB ([Vercel](https://vercel.com/docs/caching/runtime-cache#limits-and-usage)); check size on the 400-experience fixture (ADR 0008) | M | launch-critical |
| 4. Invalidation on publish | PRD-01, PRD-03, PRD-04, PRD-41, PRD-50 | ADR 0001 and 0005: partial (publish revalidates tags; no tag map, no lanes) | One tag module, `tagsForChange()` pure function, two lanes (immediate for money and terms, stale-while-revalidate for editorial) | Free. Purge calls capped at 50 a second on Hobby, 200 on Pro ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#purge-rate-limits)) | M | launch-critical |
| 5. Deploy-time cache behavior and warming | PRD-70, PRD-68 | gap | `generateStaticParams`; no production promotion from 30 minutes before to 3 hours after a send; post-deploy warm script | Free. Hobby allows 100 deployments a day ([Vercel](https://vercel.com/docs/plans/hobby)); agent fan-out (ADR 0010) can use them | S | launch-critical |
| 6. Stale serving and graceful degradation | PRD-71 | gap | ISR keeps serving stale content when revalidation fails and retries after 30 s ([Vercel](https://vercel.com/docs/incremental-static-regeneration#on-failure)); availability island falls back to "Check availability"; synthetic booking alerts | Free | S | launch-critical |
| 7. Photo ingest and validation | PRD-50, PRD-52, PRD-09, PRD-68 | ADR 0002 (R12) and 0008: partial (storage named; no processing rules) | Client direct upload to Vercel Blob, server validate and re-encode with `sharp` 0.35.5 or later, strip EXIF, store size, blur placeholder, and rights record in Postgres, random-suffix URLs | Seed script does the same once. Blob Hobby: 1 GB, 2,000 advanced operations, uploads count as advanced ([Vercel](https://vercel.com/docs/vercel-blob/usage-and-pricing)) | M | launch-critical |
| 8. Image delivery and optimization | PRD-68, PRD-09, PRD-65 | ADR 0001, 0008: partial (`next/image` named; no config) | `next/image` on Vercel: WebP only, one quality, trimmed widths, 31-day TTL, pinned `remotePatterns`, LCP photo preloaded outside Suspense | Hobby: 5,000 transformations, 300,000 cache reads, 100,000 writes a month; over the limit new images return 402 ([Vercel](https://vercel.com/docs/image-optimization/limits-and-pricing)) | S | launch-critical |
| 9. Hosted image CDN or DAM | Industry norm for photo-heavy catalogs at larger scale | gap (deliberately deferred) | None at launch. If triggered: Cloudflare Images or Cloudinary | None needed | M | later |
| 10. Database connection policy | PRD-70, PRD-16, PRD-22 | ADR 0002: partial (HTTP vs WebSocket named; no pooler rule) | `-pooler` host for all app traffic; direct host only for migrations, `pg_dump`, CI; HTTP driver for reads; WebSocket pool per request for holds | Same on Neon Free | S | launch-critical |
| 11. Database compute floor and read path under spikes | PRD-70, PRD-71 | ADR 0002: partial (warm-up request suggested) | Neon Launch, scale-to-zero off, floor 0.25 to 0.5 CU, ceiling 4 CU; replica only on a trigger | Neon Free: 100 CU-hours a month, scale-to-zero cannot be disabled ([Neon](https://neon.com/docs/introduction/plans)) | S | launch-critical |
| 12. Font delivery | PRD-68, PRD-67, PRD-77 | gap (ADR 0005 silent) | `next/font/local`, variable WOFF2, Latin subset, 2 families at most | Free; no platform limit. Needs a web-embedding licence for the brand fonts | S | launch-critical |
| 13. Static asset caching, compression, HTTP | PRD-68 | ADR 0007: covered (platform default) | Vercel defaults: static assets cached for the deployment, immutable `_next/static` ([Vercel](https://vercel.com/docs/caching/cdn-cache#static-files-caching)) | Same. Counts toward Hobby's 100 GB and 1M requests | S | launch-critical |
| 14. Link prefetch budget | PRD-68, PRD-11 | gap | Default App Shell prefetch on cards; no `prefetch={true}` in lists | Free | S | before scale |
| 15. Spike and load validation | PRD-70, PRD-71 | ADR 0006: partial (k6 against a preview; conflicts with Vercel policy) | k6 against self-hosted `next start` plus a Neon branch; small Vercel-side header checks; one approval request to Vercel | Free on GitHub-hosted runners or a small VM. Does not exercise the Vercel CDN or Runtime Cache | M | launch-critical |
| 16. Cache observability and cost guardrails | PRD-68, PRD-70, PRD-71, C-01 | ADR 0007: partial (vitals and errors planned; no cache metrics, spend cap named) | Observability Plus (default for new Pro teams), Spend Management alerts, cache probe in the synthetic job | Hobby keeps 12 hours of observability data and 1 hour of runtime logs ([Vercel](https://vercel.com/docs/observability/observability-plus#limitations)); use a probe that logs `x-vercel-cache` and TTFB | S | launch-critical |
| 17. Deploy-time version skew | PRD-22, PRD-71 | gap | Vercel Skew Protection on Pro | Not available on Hobby ([Vercel](https://vercel.com/docs/skew-protection)); avoid deploys during live demos | S | launch-critical |

## Vercel Hobby limits the demo will hit

Source dates are the page's own "last updated". Hobby is limited to non-commercial personal use ([fair use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage), 2026-09-14), and most exceeded limits mean waiting 30 days ([Hobby plan](https://vercel.com/docs/plans/hobby#hobby-billing-cycle), 2026-09-14).

| Limit | Value | What in Ramble triggers it | Mitigation |
|---|---|---|---|
| CDN requests | 1,000,000 a month ([Hobby](https://vercel.com/docs/plans/hobby), 2026-09-14) | One PRD-70-sized visitor test that loads assets: about 1.3M [inferred]. A public demo link shared widely | k6 scripts request documents and API only (37,500 per send), never `/_next/image` or static files |
| Fast Data Transfer, Fast Origin Transfer | 100 GB, 10 GB a month (same page) | Photo-heavy pages: 12,500 x 3 x 1.2 MB is about 45 GB per send [inferred] | Same as above; check the Usage dashboard before demos |
| Function invocations, Active CPU, memory | 1M, 4 CPU-hours, 360 GB-hours a month (same page) | Each experience page invokes a function for its dynamic hole. At 30 ms CPU each, one send is about 0.3 CPU-hour [inferred, CPU time assumed] | Fine for a few runs; the harness runs elsewhere |
| Image transformations, cache reads, cache writes | 5,000, 300,000, 100,000 a month; exceeding returns 402 for new images, cached ones keep working ([Vercel](https://vercel.com/docs/image-optimization/limits-and-pricing), 2026-08-11) | 300 photos x 4 widths = 1,200 (24%). WebP and AVIF both = 2,400. 400 fixture experiences with distinct photos = 8,000 | One format; fixture reuses the curated photo pool; trimmed `deviceSizes`; see gap 5 |
| Runtime Cache and ISR allowances | Not listed on the Hobby page [unconfirmed]. All projects in a Hobby team share one Runtime Cache, with LRU eviction ([Vercel](https://vercel.com/docs/caching/runtime-cache#storage-scope-by-plan), 2026-08-28) | `use cache: remote` for availability and the catalog | Reads fall through to Postgres if evicted; keep the demo project alone in its team |
| Blob | 1 GB storage, 10,000 simple and 2,000 advanced operations a month, 10 GB transfer; blocked for 30 days if exceeded; 20 and 15 operations a second ([Vercel](https://vercel.com/docs/vercel-blob/usage-and-pricing), 2026-09-23) | 300 originals at about 1.5 MB is 450 MB [inferred]; 2,000 distinct fixture photos is about 3 GB. Dashboard browsing counts as operations | Fixture reuses the pool; do not list the store in a loop |
| Speed Insights | 10,000 events over a rolling 30 days; collection pauses for at least 14 days; free tier shows only Real Experience Score ([Vercel](https://vercel.com/docs/speed-insights/limits-and-pricing), 2026-09-23) | A load test that runs the script, or a few days of public traffic | Ramble's own web-vitals endpoint (ADR 0007) is the record; Speed Insights is a side view |
| Observability data | 12 hours; runtime logs 1 hour ([Vercel](https://vercel.com/docs/observability/observability-plus#limitations), 2026-07-06) | Diagnosing a cache problem a day later | Cache probe writes its own log |
| Deployments | 100 a day ([Hobby](https://vercel.com/docs/plans/hobby), 2026-09-14) | Agent fan-out: every push to a PR branch deploys a preview | Batch pushes per unit |
| Regions, Skew Protection, System Bypass | One function region ([region](https://vercel.com/docs/functions/configuring-functions/region#limits), 2026-08-11); Skew Protection on Pro and Enterprise ([skew](https://vercel.com/docs/skew-protection), 2026-09-16); System Bypass rules N/A on Hobby ([bypass](https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules#limits), 2026-08-11) | Deploying during a live demo; a load test from one IP | Do not deploy mid-demo; see gap 7 |
| Purge and revalidation calls | 50 a second per team ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#purge-rate-limits), 2026-09-03) | A script that publishes many experiences, one call per tag | Batch tags per call |
| Neon Free | 100 CU-hours a month per project; scale-to-zero after 5 minutes and cannot be disabled; 5 GB egress ([Neon](https://neon.com/docs/introduction/plans), undated) | A synthetic booking every 5 minutes (ADR 0006, 0007); CI preview branches waking | Probe at 30-minute spacing or only around demos; see gap 6 |
| Commercial use | Requesting or processing payment from site visitors is a listed commercial example ([fair use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage), 2026-09-14) | A checkout page, even with the fake gateway | ADR 0007 assumes the demo fits Hobby as a portfolio piece. Whether a test-mode checkout counts is [unconfirmed]; the page tells unsure users to contact support |

## Gap sections

### Gap 1. Hot reads: "spaces left" under a send (rows 2, 3)

Facts. `use cache` entries sit in per-instance memory, and on serverless they typically do not persist across requests ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache#runtime-caching-considerations), 2026-09-29). `use cache: remote` stores them in a handler shared by all instances, which on Vercel is the Runtime Cache: regional, ephemeral, LRU, 2 MB per item, tagged ([Vercel](https://vercel.com/docs/caching/runtime-cache), 2026-08-28). A `cacheLife` with `expire` under 5 minutes is excluded from prerender and becomes a request-time hole ([Next.js](https://nextjs.org/docs/app/api-reference/functions/cacheLife#prerendering-behavior), 2026-09-29), which is what ADR 0001 wants for dates and spaces. Next.js says remote caching pays off at a high hit rate and not when keys are mostly unique or data changes every few seconds ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote#when-to-avoid-remote-caching), 2026-08-18). The second caution applies to availability, so the pick pays off only for the few experiences a send features; long-tail experiences miss and fall through to Postgres, which is harmless.

| Option | Freshness | Postgres load at peak | New parts | Cost | Verdict |
|---|---|---|---|---|---|
| A. Direct query every request | Exact | About 14 a second [inferred] | None | Neon CU only | Works at this scale; leaves no headroom beside the hold row lock |
| B. `use cache` (in-memory) | n/a | No reduction on serverless | None | None | Reject for runtime reads |
| C. `use cache: remote`, 5 to 10 s | At most 10 s, plus event invalidation | About 1 a second | None | Runtime Cache reads $0.40 per 1M, writes $4.00 per 1M in iad1 ([Vercel](https://vercel.com/docs/pricing/regional-pricing/iad1)); about $0.05 per send [inferred] | **Pick** |
| D. Route Handler with `s-maxage=10, stale-while-revalidate=30`, client island | Same | Low | Client JS, CLS risk | CDN requests only | Request collapsing is documented for ISR and Image Optimization only ([Vercel](https://vercel.com/docs/incremental-static-regeneration/request-collapsing)), so concurrent misses per region may not collapse [inferred]. Adds INP and CLS risk |
| E. Upstash Redis cache-aside | Same | Low | A vendor, a wrapper (ARCH-8), a second store | Free: 500K commands a month, 250 MB, 10 GB bandwidth; then $0.20 per 100K ([Upstash](https://upstash.com/pricing/redis), undated) | Gives nothing C lacks at this scale. ADR 0002 already rejected a second store for holds |

Pick C, with A as the fallback:

1. `getSpacesLeft(experienceId)` returns plain numbers for all upcoming sessions in one grouped query. It carries `'use cache: remote'`, `cacheTag('availability:' + id)`, and a lifetime of revalidate 5 to 10 s, expire 60 s. Return plain objects only, never typed arrays: a Critical RCE in `use cache` functions returning typed arrays was fixed in 16.4.1 ([Next.js](https://nextjs.org/blog/nextjs-security-update-october-14-2026), 2026-10-14).
2. The cached value is advisory. The reserve call (ADR 0002) decides; a stale "3 left" ends in the PRD-21 sold-out flow.
3. Invalidate `availability:{id}` only on cancellation (PRD-28), capacity change (PRD-41), and a sell-out transition, not on every hold. Lapsed holds are picked up by the next refresh.
4. Browse cards show a next date or "sold out" computed from confirmed seats, never a count. Counts appear on the experience page and checkout only.
5. Reserve the height of the island for CLS ([Next.js streaming](https://nextjs.org/docs/app/guides/streaming#cls-cumulative-layout-shift), 2026-10-15). If the read throws, show a "Check availability" button.
6. Browse (row 3): cache the low-cardinality dimension and filter in memory, as the Next.js docs advise for search filters ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote#cache-key-considerations)). At 400 experiences the whole catalog index is about 120 KB [inferred] and a per-week session index is a few hundred KB, both under the 2 MB item cap. Normalize arguments (sorted params, date to day, attribution parameters dropped, page capped) so keys stay few.

Starting lifetimes, to tune at the walking skeleton:

| Surface | Directive | Lifetime | Tags |
|---|---|---|---|
| Experience shell | `use cache` | named `days` (revalidate 1 day, expire 1 week) | `experience:{id}`, `host:{id}` |
| Home modules | `use cache` | `hours` | `home`, `collection:{slug}`, `experience:{id}` per featured item |
| Category, neighborhood, Picks | `use cache` plus `generateStaticParams` | `hours` | `category:{c}`, `hood:{n}`, `collection:{slug}` |
| Spaces left | `use cache: remote` | revalidate 5 to 10 s, expire 60 s | `availability:{id}` |
| Catalog index, week session index | `use cache: remote` | revalidate 60 s, expire 10 min | `catalog`, `sessions:{weekStart}` |
| Sitemap | `use cache` | `hours` | `sitemap` |
| Checkout, confirmation, manage, host, ops | none | n/a | n/a |

Preset profile values are in the [`cacheLife` reference](https://nextjs.org/docs/app/api-reference/functions/cacheLife#preset-cache-profiles).

### Gap 2. Invalidation on publish (row 4)

Facts. A tag purge reaches the CDN cache, Runtime Cache, and Data Cache together ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#understanding-cache-purging), 2026-09-03). ISR content updates in all regions within 300 ms of a revalidation ([Vercel](https://vercel.com/docs/incremental-static-regeneration#benefits-of-vercels-cdn-for-isr), 2026-08-28). Limits: 128 tags per response, 256 bytes per tag, case-sensitive, no commas; 50 purge calls a second on Hobby, 200 on Pro, counting calls and not tags. `revalidateTag(tag, 'max')` serves stale while revalidating; `{ expire: 0 }` blocks the next request; `updateTag` works only in Server Actions and expires immediately ([Next.js](https://nextjs.org/docs/app/api-reference/functions/revalidateTag), 2026-08-25; [updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag), 2026-08-18). Vercel's audits list ownerless caches and an unauthenticated purge webhook as common failures ([Vercel](https://vercel.com/kb/guide/caching-antipatterns), 2026-09-16).

Design:

| Event | Tags | Lane |
|---|---|---|
| Experience published or edited (copy, photos, host) | own: `experience:{id}`, `host:{id}`. Shared: `category:{c}`, `hood:{n}`, `collection:{slug}`, `home`, `sitemap`, `catalog` | Own tags with `updateTag` in the admin Server Action, so the editor sees the change. Shared tags with `revalidateTag(tag, 'max')`, so hot pages never block during a send |
| Price, cancellation tier, capacity, tax treatment changed (PRD-41, PRD-46, PRD-78) | `experience:{id}`, `availability:{id}` | Immediate (`updateTag`). Checkout already reads the authoritative values uncached (ADR 0001) |
| Session cancelled (PRD-28), sell-out transition | `availability:{id}`, `sessions:{weekStart}` | Immediate, from a webhook or Route Handler: `revalidateTag(tag, { expire: 0 })` |
| Photo replaced | none | New random-suffix URL; update the row; the old optimized variants age out |
| Deploy | everything | Build ID in the key |

Rules: tag names live in one module that both `cacheTag()` and the invalidators import; `tagsForChange(change)` is a pure function in `lib/` with unit tests (ARCH-1); any route that can trigger a purge requires auth and fails closed; a Playwright test edits a title in the admin and sees it on the public page within 2 seconds. Effort M.

### Gap 3. Deploys, cold caches, degradation (rows 5, 6, 17)

Facts. Cache keys include the build ID, so a deploy discards `use cache` entries including remote ones ([Next.js](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote#persistence-across-deploys)). Each deployment has its own ISR cache ([Vercel](https://vercel.com/docs/incremental-static-regeneration#benefits-of-vercels-cdn-for-isr)). Optimized images persist across deployments ([Vercel](https://vercel.com/docs/caching/cdn-cache#static-files-caching)). Vercel's audits saw hit ratios drop after every release and recover during a deploy freeze, and advise staging merges and promoting manually ([Vercel](https://vercel.com/kb/guide/caching-antipatterns#2-deploy-wiped-caches)). Vercel's own spike guide says caching matters more than scaling for sudden surges, because concurrency ramps by up to 1,000 executions per 10 seconds per region ([Vercel](https://vercel.com/kb/guide/handle-order-ahead-traffic-spikes-on-vercel), 2026-09-28).

Runbook:

1. `generateStaticParams` for every published experience, category, neighborhood, and Pick. At 400 experiences this is one build, and shells are warm at deploy.
2. Freeze: no production promotion from 30 minutes before to 3 hours after a newsletter send. Merge to `main` freely, promote by hand afterwards. The send calendar comes from the head of growth.
3. After each promotion, a GitHub Actions step requests the top 20 URLs and availability keys, then asserts the second request is a CDN hit.
4. Before a send: wake Neon (ADR 0002), check `x-vercel-cache` on home and the featured experiences.
5. Degradation: ISR keeps stale content and retries every 30 s if revalidation fails ([Vercel](https://vercel.com/docs/incremental-static-regeneration#on-failure)), so shells survive a database outage. PRD-71's "page loads" half stays green; the "test booking completes" half does not, and the synthetic booking is what alerts. Checkout shows a maintenance state; the availability island shows "Check availability".
6. Skew: on Pro, Skew Protection pins framework requests to the serving deployment (default max age one day) so a deploy mid-checkout does not break a Server Action ([Vercel](https://vercel.com/docs/skew-protection)). On Hobby it does not exist; do not deploy during a live demo.

### Gap 4. Cache-safe responses and attribution parameters (row 1)

Facts. Cacheable responses use GET or HEAD, no `Set-Cookie`, no `private` or `no-store`, no `Vary: Cookie`; as of 2026-09-30 a `Vary: Cookie` response is served but not stored ([Vercel](https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria)). The cache key is method, URL, host, deployment, and scheme, and query strings are ignored for static files only ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#cache-keys)). I found no official statement for prerendered or ISR pages with query strings [unconfirmed]; a third-party mirror of a Vercel agent skill says they split the cache.

Risk: PRD-58 newsletter links carry the issue and, for consented subscribers, an identifier. About 60% of visits come from the newsletter (PRD context table). If the identifier is a query parameter and the CDN keys on it, those visits miss the CDN.

Test in the walking skeleton, ten minutes: `curl -sI` the same experience URL with no query, with `?utm_source=a&utm_campaign=issue12`, and with `?utm_source=a&sid=1`, twice each, and compare `x-vercel-cache`.

| Option | Cost | Notes |
|---|---|---|
| A. Subscriber ID in the URL fragment | None | Never sent to the server; the beacon reads it and cleans the URL. Needs the newsletter platform's link tracking to keep fragments [unconfirmed] |
| B. `/n/{token}` Route Handler that logs the click server-side and 302s to the clean URL | One hop on mobile, small LCP cost | Counts clicks without JavaScript, which helps G4's lower bound. Function invocation per click |
| C. Accept per-subscriber keys | ISR reads and function work per visit | Only if the test shows keys do not split |

Pick: run the test; campaign parameters (`utm_*`, issue) stay in the query because they are few per page; the subscriber identifier goes through B, or A if the platform allows. Also: set the device cookie for PRD-17 only inside Server Actions and Route Handlers (hold, checkout), never in a layout, proxy, or cached route; CI asserts no `Set-Cookie` and no `Vary: Cookie` on `/`, experience, category, neighborhood, and Pick pages. Next.js sends HTML-limited bots (social preview scrapers) a dynamic render instead of the shell ([Next.js](https://nextjs.org/docs/app/guides/streaming#bots-and-crawlers)), so metadata data must come from cached functions too. Effort S.

### Gap 5. Image pipeline (rows 7, 8, 9)

Facts. Vercel bills a transformation on every cache MISS and STALE, a cache write on the same events, and a cache read when an image comes from the global cache, in 8 KB units ([Vercel](https://vercel.com/docs/image-optimization/limits-and-pricing), 2026-08-11). The cache key is project, `q`, `w`, source URL, and the `Accept` header; a hero in 2 formats x 2 qualities x 8 widths is up to 32 entries ([Vercel KB](https://vercel.com/kb/guide/reduce-image-optimization-costs-on-vercel), 2026-09-30). Sources up to 8,192 px per side and 10 MB output ([Vercel](https://vercel.com/docs/image-optimization/limits-and-pricing#limits)). Next.js 16 defaults: `formats: ['image/webp']`, `qualities: [75]` (required), `minimumCacheTTL` 14,400 s; AVIF is about 20% smaller and 50% slower to encode ([Next.js](https://nextjs.org/docs/app/api-reference/components/image), 2026-09-28). Vercel's image page says the default TTL is 3,600 s ([Vercel](https://vercel.com/docs/image-optimization#remote-images-cache-key), 2026-08-13); the two pages disagree, so set it explicitly. Blob URLs default to a one-month cache and `addRandomSuffix` is recommended ([Vercel](https://vercel.com/docs/vercel-blob/using-blob-sdk), 2026-08-26). Function request bodies are capped at 4.5 MB ([Vercel](https://vercel.com/docs/functions/limitations#request-body-size), 2026-08-24). An SVG-triggered RCE in the image API was fixed in 16.4.1, with `sharp` 0.35.5 or later as the workaround ([Next.js](https://nextjs.org/blog/nextjs-security-update-october-14-2026)).

| Option | Cost at Ramble's size | Fit |
|---|---|---|
| A. `next/image` on Vercel, originals in Blob | Pro: 2,400 photos x 5 variants = 12,000 transformations at $0.05 per 1K = $0.60, plus about $0.72 of cache writes [inferred: list rates in iad1, 120 KB average output assumed] | **Real-job pick.** No extra vendor; matches ADR 0002 R12 and 0008 |
| B. Variants pre-generated with `sharp` at ingest or seed, served `unoptimized` or by a custom loader | `putImage()` bills one transformation per variant plus Blob operations ([Vercel](https://vercel.com/docs/vercel-blob/using-blob-sdk)); serving is free of transformation charges | Demo escape hatch if Hobby's 5,000 is tight; more code; no 402 failure mode |
| C. Hosted service | Cloudinary Free: 25 credits (1 credit = 1,000 transformations, 1 GB storage, or 1 GB bandwidth), Plus $99 a month for 225 ([Cloudinary](https://cloudinary.com/pricing)). imgix: no free tier listed, 30-day trial, Starter $25 a month ([imgix](https://imgix.com/pricing)). ImageKit Free: 20 GB bandwidth, 3 GB storage; Lite $9 ([ImageKit](https://imagekit.io/plans)). Cloudflare Images: 5,000 unique transformations free, then $0.50 per 1K ([Cloudflare](https://developers.cloudflare.com/images/pricing/), page dated 2026-10-12). Bunny Optimizer: $9.50 per site, unlimited transformations ([Bunny](https://www.bunny.net/pricing/optimizer/)) | Buys focal-point crops and a media library. Ramble's ops standard (PRD-50) and Postgres rights record cover the need. Commercial-use terms for the free tiers are not stated on the pages I read [unconfirmed]. Cloudflare Images works as a URL transformer for a zone on Cloudflare; its use behind a Vercel-hosted site is [unconfirmed] |

Pick A. Revisit C if host self-serve (PRD-49) brings unvetted uploads at volume, or editorial wants art-directed crops.

Ingest rules (PRD-50, PRD-52):

1. Direct browser-to-Blob upload (4.5 MB function body cap), then a server step that decodes the file, checks the long edge is at least 1,600 px (PRD-50) and at most 8,192 px, accepts JPEG, PNG, WebP, AVIF only, rejects SVG and animation, and caps the file at 10 MB [cap is my assumption].
2. Re-encode with `sharp` 0.35.5 or later and drop EXIF and GPS, since host photos can carry the studio's or a home's location [inferred norm].
3. Store `width`, `height`, a small `blurDataURL`, and the rights record in Postgres beside the URL (ADR 0002). Cap photos per experience at 8 [assumption] to bound transformations.
4. Random-suffix URLs make every image immutable; a replacement is a new URL. If a URL must be reused, purge with `invalidateBySrcImage` ([Vercel](https://vercel.com/docs/caching/cdn-cache/purge#programmatically-purging-cdn-cache)).

Delivery config:

| Setting | Value | Reason |
|---|---|---|
| `formats` | `['image/webp']` | AVIF doubles transformations and cache entries ([Vercel KB](https://vercel.com/kb/guide/reduce-image-optimization-costs-on-vercel)); revisit on Pro after measuring transfer |
| `qualities` | `[75]` | Each extra value multiplies variants |
| `deviceSizes`, `imageSizes` | Trim to the layout, for example `[640, 828, 1080, 1200, 1920]` and `[96, 256, 384]` | Fewer widths, fewer misses |
| `minimumCacheTTL` | 2,678,400 (31 days) | URLs are immutable |
| `remotePatterns` | The Blob store host and path prefix only | Stops anyone using the optimizer as an open proxy ([Vercel](https://vercel.com/docs/image-optimization#setting-up-remote-or-local-patterns)) |
| `dangerouslyAllowSVG` | `false` | Image API advisory |
| LCP photo | `preload`, `fetchPriority="high"`, outside any Suspense boundary, accurate `sizes` | An LCP element inside Suspense waits for the swap ([Next.js streaming](https://nextjs.org/docs/app/guides/streaming#lcp-largest-contentful-paint)) |
| New publish | Request the cover photo at the three common widths from `after()` | The first visitor otherwise pays the encode |

Demo plan (Hobby): the 60 curated experiences (about 300 photos, 4 widths, WebP) use about 1,200 transformations. The 400-experience scale fixture reuses the same photo pool, since distinct photos would need 8,000. k6 never requests `/_next/image`. A pre-demo check of the Usage page replaces an alert. Blob holds originals under 1 GB.

### Gap 6. Database connection policy, compute floor, read path (rows 10, 11)

Facts. Neon's pooler is PgBouncer in transaction mode, 10,000 client connections, pool size 90% of `max_connections`; `max_connections` is 104 at 0.25 CU, 209 at 0.5 CU, 419 at 1 CU. Session-level advisory locks, `SET`, and SQL `PREPARE` do not work through it; protocol-level prepared statements do. Neon advises the pooled string for serverless and the direct string for migrations and `pg_dump` ([Neon](https://neon.com/docs/connect/connection-pooling), undated). Neon calls the HTTP driver the fastest option for single queries; the WebSocket `Pool` is for interactive transactions and must be created and closed inside one request ([Neon](https://neon.com/docs/serverless/serverless-driver)). Compute suspends after 5 minutes idle with a restart within a few hundred milliseconds ([Neon](https://neon.com/docs/introduction/scale-to-zero)); Free cannot disable this, Launch can ([Neon plans](https://neon.com/docs/introduction/plans)). Launch includes no CU-hours and charges $0.106 per CU-hour; autoscaling takes a min and max CU with at most an 8 CU span ([Neon autoscaling](https://neon.com/docs/introduction/autoscaling)). Read replicas are separate computes, asynchronous and eventually consistent ([Neon](https://neon.com/docs/introduction/read-replicas)). Functions default to `iad1` (Washington, D.C.); Hobby allows one region, Pro five ([Vercel](https://vercel.com/docs/functions/configuring-functions/region)). If a `pg` pool is used instead, Vercel's guide says to create it at module scope and call `attachDatabasePool` so idle connections close before suspension ([Vercel KB](https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute), 2026-06-17).

| Setting | Recommendation |
|---|---|
| Host | `-pooler` endpoint for every app path. Direct endpoint only for migrations, `pg_dump` (ADR 0002 item 12), and the CI concurrency test |
| Reads | Neon HTTP driver through Drizzle `neon-http`, one statement per read |
| Hold and reserve | WebSocket `Pool` created and closed per request, transaction-level locks only (ADR 0002 already says so) |
| Region | Functions in `iad1`; confirm the Neon project is in AWS N. Virginia at provisioning |
| Real-job compute | Launch plan, scale-to-zero off, floor 0.25 to 0.5 CU, ceiling 4 CU. Always-on cost: 0.25 CU x 730 h x $0.106 = $19; 0.5 CU = $39 [inferred] |
| Read replica | Not at launch. Trigger: primary CPU above 60% from read paths after caching, or investor-report and dashboard queries (PRD-59, PRD-60) competing with checkout |
| Slow-query log | Log statements over 100 ms [threshold assumed]; review after the first send |

Demo trap: on Free, a synthetic booking every 5 minutes means compute never reaches its 5-minute idle suspend. At a 0.25 CU floor [unconfirmed], that is 6 CU-hours a day and the 100-hour allowance is gone in about 16 days [inferred]. A probe every 30 minutes keeps the duty cycle near 17% (about 30 CU-hours a month) [inferred]. Preview-branch databases (ADR 0002) also consume CU-hours while their E2E runs.

### Gap 7. Load testing under Vercel's policy (row 15)

Facts. Vercel limits load testing to Enterprise plans; before an Enterprise contract it must be arranged with the sales manager; tests without notice likely breach fair use and have their source IPs blocked ([Vercel policy](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments), updated 2025-11-24). The production checklist and the 2026-09-28 spike guide repeat Enterprise only ([checklist](https://vercel.com/docs/production-checklist), [spike guide](https://vercel.com/kb/guide/handle-order-ahead-traffic-spikes-on-vercel)). The December 2025 how-to is softer: coordinate first, add System Bypass rules, ramp gradually, target dynamic routes ([Vercel](https://vercel.com/kb/guide/how-to-effectively-load-test-your-vercel-application)). System Bypass rules exist on Pro (25 per project) and Enterprise, not Hobby ([Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules)). A Protection Bypass for Automation secret works on all plans and also skips system mitigations, but not active attack mitigations ([Vercel](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)). The pages conflict; whether Vercel would approve a Pro-plan test is [unconfirmed].

| Option | Proves | Policy fit |
|---|---|---|
| A. k6 against self-hosted `next start` of the production build, Neon branch, two CI runners or a small VM | Render path, Postgres, pooler, hold row lock, 99% checkout completion | No Vercel traffic. Does not exercise the CDN or Runtime Cache |
| B. k6 against a Vercel preview | The full path | Policy says Enterprise only; risks an IP block; Hobby has no System Bypass |
| C. Ask Vercel support to approve one pre-launch test on Pro | The full path | Outcome unknown; costs a ticket |
| D. A few-request smoke on Vercel previews (not a load test) | Cache headers and hit behavior | Within normal use |

Pick: A for capacity, repeated nightly or before each large release (ADR 0006), D inside the Playwright smoke (second request is a hit, no `Set-Cookie`), and C once before launch with the answer recorded. To keep A honest, set a small `cacheMaxMemorySize` so the in-memory cache does not flatter the result (effect of a small value is [unconfirmed]), and ramp up with k6 `ramping-arrival-rate` to the PRD-70 shape (about 7 visitors a second). Lighthouse CI on previews: first load is cold (CDN, Neon, image variants), so warm each URL once and take the median of three runs; pass the automation bypass header so Deployment Protection does not block it. Effort M.

### Gap 8. Fonts, static assets, prefetch (rows 12, 13, 14)

- Fonts. `next/font` downloads or reads font files at build and serves them from the same origin with the other static assets, so the browser never calls Google ([Next.js](https://nextjs.org/docs/app/api-reference/components/font), 2026-09-24). Defaults: `display: 'swap'`, `preload: true`, and a size-adjusted fallback (`'Arial'` for local fonts) to cut layout shift. Brand fonts are not chosen (C-07): use `next/font/local` with variable WOFF2, Latin subset, 2 families at most, preload only fonts used above the fold, total first-view font weight under 100 KB [budget assumed]. Confirm the web-embedding licence with the designer. A font vendor's script would break the checkout script inventory (ADR 0003).
- Static assets. Vercel caches static files for the deployment and serves `_next/static/immutable` assets with a one-year `immutable` header; no action needed. Do not put another CDN in front ([Vercel KB](https://vercel.com/kb/guide/why-running-another-cdn-on-top-of-vercel-is-not-recommended)): its cache is not purged by Vercel, stale HTML references purged assets, and users see errors after deploys.
- Prefetch. Partial prefetching fetches each route's App Shell by default; `prefetch={true}` renders the destination again with its URL data, which costs a server invocation per prefetchable link ([Next.js](https://nextjs.org/docs/app/getting-started/caching#prefetching)). A 24-card browse page with `prefetch={true}` on every card is up to 24 invocations per view. Keep the default on cards; allow `prefetch={true}` only on the primary call to action.

### Gap 9. Cache observability and cost guardrails (row 16)

- Pro: Observability Plus is $1.20 per 1M events and on by default for teams created after 2026-04-03 ([Vercel](https://vercel.com/docs/observability/observability-plus)). Spend Management notifications default to $200 a billing cycle; Pro is $20 a month with $20 of usage credit ([Vercel](https://vercel.com/docs/plans/pro-plan)). Set alerts at a figure Tom approves, and watch the Runtime Cache, ISR, and Image Optimization panels the week after launch.
- Cache probe (works on Hobby): the ADR 0007 synthetic job also requests home, three featured experiences, and one category page, and records `x-vercel-cache` and TTFB. Proposed budgets, to be set after measurement: document hit rate at or above 95% outside deploy windows, availability remote-cache hit rate at or above 80% during sends.
- Cost sketch for the real job, on the order of $100 a month [inferred]: Pro platform fee $20 (extra seats $20 each); CDN about 9.5M requests a month at 90,000 visits x 3 pages x 35 requests, so the $20 tier (10M requests, 50 TB) or about $17 on demand at $2 per 1M ([Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn), [iad1](https://vercel.com/docs/pricing/regional-pricing/iad1)); Neon $19 to $39 plus storage; images and Runtime Cache a few dollars; Observability Plus by events.

### Demo build: what to implement free, and what stays real-job only

Implement in the demo: the lifetime table as `cacheLife` profiles; the tag module and the admin publish action with its Playwright test; `getSpacesLeft` on `use cache: remote`; the no-cookie and cache-hit header test; the image config and a seed pipeline that re-encodes once and stores size and blur data; the photo pool reused by the fixture; pooled Neon URL and the driver split; `next/font/local`; a cache probe at 30-minute spacing; the k6 harness on `next start` plus a Neon branch.

Real job only: Pro plan, Flat Rate CDN tier, Skew Protection, System Bypass rules, Observability Plus, Spend Management, Neon Launch with scale-to-zero off, a Vercel-side load-test approval, the AVIF decision, a read replica, any hosted image service.

## Proposed ADR changes

| Target | Change |
|---|---|
| New ADR 0011, "Cache policy and image delivery" (R13) | One home for gaps 1 to 5 and 8. Contents: lifetime table per surface; `use cache: remote` for runtime-hot reads and why not Redis (with the trigger to revisit: Q-20 above 10x, or more than one function region); tag module and two invalidation lanes; cache-safe response rules (no `Set-Cookie` or `Vary: Cookie` on guest routes, attribution identifier outside the query string, test result recorded); deploy runbook (freeze window, `generateStaticParams`, warm script); image ingest rules and `next/image` config table; font rule; prefetch rule. Status: proposed, for Dave |
| ADR 0002 | Add a connection policy (pooled host, driver split, direct host for admin and dump, per-request WebSocket pool) and a compute floor for the real job (Launch, scale-to-zero off, 0.25 to 0.5 CU floor). Add the read-replica trigger to "What would change the call". Note that availability shown on cached pages is advisory and reserve is authoritative |
| ADR 0005 | Cross-reference ADR 0011 for fonts: `next/font/local`, variable WOFF2, Latin subset, licence check, and the checkout script-inventory rule |
| ADR 0006 | Replace "k6 against a preview" with the self-hosted harness (gap 7); add the cache-header assertions to the smoke test; Lighthouse CI warms each URL and sends the automation bypass header; add the cache probe |
| ADR 0007 | Add the Hobby limits table as a demo constraint; state the deploy freeze window; add Pro-only items to the real-job list (Skew Protection, Observability Plus, Spend Management, Flat Rate CDN tier); set the synthetic booking cadence so Neon Free survives the month; record that a test-mode checkout on Hobby may count as commercial use and should be confirmed with Vercel; record that no third-party CDN sits in front |
| ADR 0008 | The scale fixture reuses the curated photo pool; the manifest records width, height, and blur data; k6 never fetches `/_next/image` |
| PRD (client conversation, not an ADR) | Ask the head of growth for the newsletter send calendar (deploy freeze) and whether the newsletter platform keeps URL fragments (gap 4). Q-20 still sizes everything above |

## Sources

All read 2026-10-18. "Updated" is the page's own date; "undated" means none shown.

| Source | Updated |
|---|---|
| [Vercel Hobby plan](https://vercel.com/docs/plans/hobby) | 2026-09-14 |
| [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) | 2026-09-15 |
| [Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) | 2026-09-14 |
| [Vercel limits](https://vercel.com/docs/limits) | 2026-09-16 |
| [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache) | 2026-09-14 |
| [Vercel cache purging](https://vercel.com/docs/caching/cdn-cache/purge) | 2026-09-03 |
| [Vercel Runtime Cache](https://vercel.com/docs/caching/runtime-cache) | 2026-08-28 |
| [Vercel ISR](https://vercel.com/docs/incremental-static-regeneration), [ISR pricing](https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing), [request collapsing](https://vercel.com/docs/incremental-static-regeneration/request-collapsing) | 2026-08-28, 2026-08-11, 2026-08-11 |
| [How Vercel CDN works](https://vercel.com/docs/how-vercel-cdn-works) | 2026-03-05 |
| [Vary: Cookie change](https://vercel.com/changelog/vary-cookie-responses-no-longer-cached) | 2026-09-30 |
| [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn), [iad1 pricing](https://vercel.com/docs/pricing/regional-pricing/iad1), [regional pricing](https://vercel.com/docs/pricing/regional-pricing) | 2026-09-14 |
| [Image optimization](https://vercel.com/docs/image-optimization), [limits and pricing](https://vercel.com/docs/image-optimization/limits-and-pricing), [cost KB](https://vercel.com/kb/guide/reduce-image-optimization-costs-on-vercel) | 2026-08-13, 2026-08-11, 2026-09-30 |
| [Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk) | 2026-09-23, 2026-08-26 |
| [Functions limits](https://vercel.com/docs/functions/limitations), [Fluid pricing](https://vercel.com/docs/functions/usage-and-pricing), [regions](https://vercel.com/docs/functions/configuring-functions/region) | 2026-08-24, 2026-06-16, 2026-08-11 |
| [Caching antipatterns](https://vercel.com/kb/guide/caching-antipatterns), [spike guide](https://vercel.com/kb/guide/handle-order-ahead-traffic-spikes-on-vercel) | 2026-09-16, 2026-09-28 |
| [Load-test policy](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments), [load-test how-to](https://vercel.com/kb/guide/how-to-effectively-load-test-your-vercel-application), [production checklist](https://vercel.com/docs/production-checklist) | 2025-11-24, 2025-12-09, 2026-08-11 |
| [DDoS mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation), [System Bypass rules](https://vercel.com/docs/vercel-firewall/vercel-waf/system-bypass-rules), [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) | 2026-08-11, 2026-08-11, 2026-09-16 |
| [Observability Plus](https://vercel.com/docs/observability/observability-plus), [Speed Insights limits](https://vercel.com/docs/speed-insights/limits-and-pricing), [Skew Protection](https://vercel.com/docs/skew-protection) | 2026-07-06, 2026-09-23, 2026-09-16 |
| [Another CDN in front of Vercel](https://vercel.com/kb/guide/why-running-another-cdn-on-top-of-vercel-is-not-recommended), [paused deployments](https://vercel.com/kb/guide/why-is-my-account-deployment-blocked), [Fluid connection pools](https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute) | 2026-01-08, 2026-10-02, 2026-06-17 |
| Next.js: [use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache), [use cache: remote](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote), [cacheLife](https://nextjs.org/docs/app/api-reference/functions/cacheLife), [revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag), [updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag), [caching guide](https://nextjs.org/docs/app/getting-started/caching), [Image](https://nextjs.org/docs/app/api-reference/components/image), [Font](https://nextjs.org/docs/app/api-reference/components/font), [streaming](https://nextjs.org/docs/app/guides/streaming) | 2026-09-29, 2026-08-18, 2026-09-29, 2026-08-25, 2026-08-18, 2026-10-06, 2026-09-28, 2026-09-24, 2026-10-15 |
| [Next.js security update 2026-10-14](https://nextjs.org/blog/nextjs-security-update-october-14-2026) | 2026-10-14 |
| Neon: [connection pooling](https://neon.com/docs/connect/connection-pooling), [plans](https://neon.com/docs/introduction/plans), [scale to zero](https://neon.com/docs/introduction/scale-to-zero), [autoscaling](https://neon.com/docs/introduction/autoscaling), [serverless driver](https://neon.com/docs/serverless/serverless-driver), [read replicas](https://neon.com/docs/introduction/read-replicas) | undated |
| [Upstash Redis pricing](https://upstash.com/pricing/redis), [Upstash on the Vercel Marketplace](https://vercel.com/marketplace/upstash) | undated |
| [Cloudinary](https://cloudinary.com/pricing), [imgix](https://imgix.com/pricing), [ImageKit](https://imagekit.io/plans), [Bunny Optimizer](https://www.bunny.net/pricing/optimizer/) | undated (footers 2026) |
| [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/) | page dated 2026-10-12 |

Not confirmed: Hobby allowances for Runtime Cache and ISR; query-string handling of prerendered pages in the CDN cache key; Neon Free's minimum compute size; whether Vercel would approve a Pro-plan load test; whether a test-mode checkout counts as commercial use on Hobby; free-tier commercial terms for Cloudinary, ImageKit, and imgix; Cloudflare Images behind a Vercel-hosted site; whether newsletter link tracking keeps URL fragments; the effect of a small `cacheMaxMemorySize`. Prices are list rates, which change often; recheck before the estimate.

Instructions in fetched pages, not acted on: every Vercel docs page carries a front-matter line telling coding agents to run `npx plugins add vercel/vercel-plugin` and a block telling agents to follow related links; Neon's read-replicas page asked AI assistants to send feedback to an external URL. I ran nothing and submitted nothing.
