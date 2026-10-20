---
title: U-008a and U-009, combined Cache Components spike
date: 2026-10-19
status: done 2026-10-20 (local `next start` and a Vercel Hobby deployment, project `ramble-spike`)
units: U-008a (nonce CSP), U-009 (cache conventions and tag map)
code: docs/adr/research/spikes/u-008a-009-cache/
stack: Next.js 16.4.2 (Turbopack), React 19.3.1, `cacheComponents: true`, `partialPrefetching: true`, `next start` on a local machine
---

# Cache Components spike (U-008a and U-009)

## Questions

1. **U-008a.** Can the proxy set a nonce CSP on fully dynamic routes (checkout, manage, ops) and a report-only CSP on cached and partially prerendered routes, without the nonce read pushing the cached routes to dynamic rendering?
2. **U-009.** Do `cacheLife`, `cacheTag`, `updateTag`, and `revalidateTag` behave as the design assumes, and what happens when the remote runtime cache fails?

## Answers

### U-008a: yes, with one hard rule

| Check | Result |
|---|---|
| Proxy sets an enforcing nonce CSP on `/checkout`, `/manage/*`, `/ops` and a nonce-free report-only CSP elsewhere | Works. Headers are right on every route under `next start` |
| Nonce CSP on a **partially prerendered** route (`/checkout` with a `<Suspense>` hole reading the nonce) | **Fails in the browser.** The static shell's `<script async>` chunks and two inline scripts carry no nonce, so `strict-dynamic` blocks them: 10 CSP errors, the page never hydrates (checked in Chromium). This is what the Next docs say about PPR and nonces |
| Nonce CSP on a route with `export const instant = false` and no Suspense hole (`/ops`) | **Works.** All 11 script tags carry the nonce, the inline `<Script nonce>` runs, the client button hydrates, zero console errors. Build marks it `ƒ` |
| Report-only CSP on cached routes (`/`, `/category/*`, `/experience/*`) | Works. Zero console errors; pages stay `○` (static) or `◐` (partial prerender) |
| Layout reads `headers()` for the nonce, outside Suspense | **Build fails** ("uncached or runtime data during prerendering"). It does not silently go dynamic |
| Layout reads `headers()` for the nonce, inside Suspense | Builds, but every cached route drops from `○` to `◐` (it gains a dynamic hole). That is the cost the spike question named |
| A dynamic route that reads `connection()` or `headers()` with no Suspense | Build fails unless the route sets `export const instant = false` or wraps the read in Suspense |

**Rule for U-008a.** The nonce is read only inside the dynamic route trees. Those trees (`/checkout`, `/manage`, `/ops`, `/host` if it is dynamic) are fully dynamic: `export const instant = false`, no Suspense hole, and they live in their own route group with their own root layout so the nonce read never touches the shared layout. Cached routes get the report-only header from the proxy and no nonce. The proxy matcher must skip prefetches (`next-router-prefetch`, `purpose: prefetch`), as in the Next example.

**Consequence for checkout.** A fully dynamic checkout renders its whole page per request, so it loses the cached shell. PRD-68's checkout budgets must be met on a dynamic page; the Perf Lab should expect that.

**Not proved here.** Report-only mode never blocks, so the cached routes' policy is untested for real violations. A hash- or SRI-based enforcing policy for cached routes (`experimental.sri`) is the later upgrade path; it was not tried.

### U-009: tags and runtime cache behave as designed; failure handling needs a wrapper

| Check | Result |
|---|---|
| `'use cache'` + `cacheLife({revalidate: 3600, expire: 86400})` + `cacheTag` on prerendered pages | Hits are stable; page headers `s-maxage=3600, stale-while-revalidate=82800` on fully cached routes |
| `revalidateTag(tag, 'max')` from a route handler | Stale-while-revalidate: the first request after serves the old page, the second is fresh. Same on `food` and `kayak` |
| `revalidateTag(tag, {expire: 0})` from a route handler | Next request is fresh on `food`. **On `kayak`, the first request after a prior revalidation returned the original build-time page, older than one already served, then fresh.** Reproduced twice on `kayak`, never on `food`. Treat "expire: 0 means never stale" as unproven for prerendered pages |
| `updateTag(tag)` from a Server Action (button click in the browser) | Same pattern as above on `kayak`: one request returned the build-time page, then fresh. The data function was fresh at once |
| `'use cache: remote'` for spaces left (`revalidate: 8`, `expire: 60`, tag per session) under the default in-memory handler | Same value for 8 s, a fresh read after 9 s; tag invalidation (`max` and `expire: 0`) re-reads |
| Guest routes send no `Set-Cookie` and no `Vary: Cookie` | Confirmed on `/`, `/category/*`, `/experience/*` (the `Vary` header lists only RSC headers and `Accept-Encoding`) |
| Remote handler that throws on every call (`cache-handlers/failing.js`, models an outage) | The build still succeeds. At request time the streamed hole errors with a digest instead of rendering, and the cached shell around it still returns 200. A `try/catch` around the remote read renders a fallback in its place |

**Rules for U-009.**
- Every `'use cache: remote'` read goes through one wrapper that catches the failure and falls back to a direct Postgres read (Postgres stays authoritative at reserve, ADR 0002). Test it in CI with a failing handler like the spike's.
- Publish paths use `updateTag` in Server Actions (the ops publish flow). Webhook or job paths that cannot use it use `revalidateTag(tag, 'max')` and accept one stale response. Do not build any correctness rule on `expire: 0` serving fresh data.
- `partialPrefetching: true` must be set next to `cacheComponents: true` (a build warning otherwise). Stack-decisions and ADR 0001 should name it.
- The CI test "guest routes send no cookies" is easy to write: read `Set-Cookie` and `Vary`.

## Vercel Hobby run (2026-10-20, project `ramble-spike`, same app, read-only requests through `vercel curl`)

| Check | Result on Vercel |
|---|---|
| CSP per route | Same as local: enforcing nonce CSP on `/checkout`, `/manage/*`, `/ops`; report-only elsewhere |
| Scripts without a nonce | `/ops` (fully dynamic): **0**. `/checkout`: **9** and `/manage/abc`: **8**, both partial prerenders. The local finding holds: PPR plus a nonce loses the shell's scripts (not re-checked in a browser on Vercel) |
| Runtime cache (`'use cache: remote'`, revalidate 8 s) | The `ran` time stayed the same across three back-to-back reads, then refreshed after about 10 s |
| `revalidateTag(tag, 'max')` | One stale response, then fresh, as designed |
| `revalidateTag(tag, {expire: 0})` | Fresh on the very next request (the local `kayak` oddity of an older build-time page did not appear on Vercel in this run) |
| Tag invalidation of the runtime-cache entry (`session-1`, expire 0) | New `ran` time on the next read |
| `Set-Cookie` / `Vary: Cookie` on guest routes | None on `/`, `/category/kayak`, `/experience/1` |

Limits: one region, one low-traffic deployment, so cross-instance sharing of the runtime cache is only inferred (the same value returned across requests), not shown. Only `revalidateTag` was exercised on Vercel; `updateTag` from a Server Action was checked locally only.

Side effects on the account: the project `ramble-spike` exists (its first deploy went to production by default), and `vercel curl` generated a protection-bypass token for it. Delete the project when this is no longer needed.

## Re-score

| Unit | Before | After | Why |
|---|---|---|---|
| U-008a | C2 U3, human-led | C2 U2, agent fan-out | The one real risk (PPR plus nonce) is answered, and the fix is a structural rule the ticket can state |
| U-009 | C2 U3, human-led | C2 U2, agent fan-out | Tag, `updateTag`, and runtime-cache semantics observed; failure handling is a known wrapper. Confirmed on Vercel Hobby |

Both tickets should carry the rules above in their scope. The Vercel run passed, so U-009's condition is met.
