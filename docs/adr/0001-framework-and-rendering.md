# ADR 0001: Framework and rendering

- **Status:** Accepted 2026-10-18 (Dave), as recommended. The global standards baseline was moved to Next.js 16.4.1+ and React 19.3 the same day.
- **Date:** 2026-10-18
- **Question:** R1 in `docs/plan/BUILD-PLAN.md`
- **Research:** [research/r1-framework-rendering.md](research/r1-framework-rendering.md)
- **Settles stack decisions:** framework and version, React version, DATA-10 (caching model)

## Context

Ramble is half editorial site (home, Ramble Picks, gift guide, category, neighborhood, and guide pages that must rank and load fast on phones) and half application (booking, checkout, host and ops tools). The client has no engineers (C-04). Dave's standards are written for Next.js App Router and React Server Components; a Perf Lab brief (a vault note, not a requirement) wants a later branch that shows navigation across the App Router and Pages Router boundary.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-01, PRD-03, PRD-13, PRD-63 to PRD-66 | Indexable editorial pages, redirects from the current site, structured data |
| PRD-68, PRD-70 | Core Web Vitals "good" on mobile, including under newsletter spikes |
| PRD-14 to PRD-22 | An interactive, single-page booking and checkout |
| PRD-39 to PRD-56, PRD-74 | Authenticated host, ops, and admin surfaces |
| PRD-67, PRD-77 | Phone first; one brand system across the site |
| C-01, C-04 | Maintainable on about $8k a month by a client with no engineers |

## Options

**Framework**

| | A1. Next.js App Router, Server Components by default | A2. React Router v8, framework mode | A3. Astro 7 with React islands |
|---|---|---|---|
| Editorial pages | Strong: metadata, sitemap, JSON-LD, tag revalidation | Adequate: no sitemap helper or tag invalidation found | Strong: static by default; sitemap gap for on-demand routes |
| JavaScript on phones | Adequate: server components by default; not measured | Strain: whole-route hydration (inferred); its server-component mode is still unstable | Strong on content pages; adequate on booking islands |
| Booking and host tools | Strong | Strong | Strain: app-shaped surfaces in an islands model |
| Fit with Dave's standards | Direct | Many Next-specific rules replaced | Server-component and Next rules replaced |
| Maturity | Cache Components is young; three advisories in two weeks in `use cache` | Server components unstable | Version 7 is four months old |

Also screened and not weighed: TanStack Start (stable only since 2026-10-13); an Astro plus Next split (a hard navigation between the experience page and checkout); a client-only single-page app (puts PRD-65 and PRD-68 at risk).

**Routers**

- **B1. App Router only.** One header, one metadata system, instant navigation through the funnel.
- **B2. Mix the App Router and Pages Router from the start.** No PRD requirement justifies it. Navigation across the boundary is a hard reload without prefetch, and the header and metadata get built twice.
- **B3. App Router now; add a `pages/` area in the Perf Lab branch.** About 1 to 2 days in that branch (an estimate, not measured), cheap because the standards already keep logic in `lib/`.

## Recommendation

**A1 with B3.** Next.js App Router with Server Components by default, App Router only in the best-case build, and a `pages/` area added later in the Perf Lab branch with a recorded standards departure there.

- **Version:** Next.js 16.4.1 or later (two Critical advisories were fixed on 2026-10-14, one in `use cache`) and React 19.3. Dave's standards baseline says 16.3.8 and React 19.2 (checked 2026-10-06) and should move before the walking skeleton.
- **Caching model (DATA-10):** `cacheComponents: true`, the vendor's recommended model and the default in the next major release. It gives cached shells, tag revalidation when staff publish, and instant navigation. Condition: a named owner for framework patches (below).
- **Rendering by surface:**

| Surface | PRD | Rendering |
|---|---|---|
| Home, Picks, gift guide, category, neighborhood, and guide pages | 01, 03, 04, 13, 65 | Cached with `'use cache'` and tags; publishing revalidates; metadata and JSON-LD in the server HTML |
| Browse and filter | 02, 05 | Filters in the URL; short-lived cached results; filter combinations beyond category and neighborhood set to noindex |
| Experience page | 09 to 12, 66 | Cached shell for copy, photos, host, and terms; dates and spaces left streamed with reserved space; the booking bar is one client island |
| Checkout | 14 to 22 | Dynamic, uncached, noindex; a client island for the payment form and hold timer; a Server Action with an idempotency key |
| Confirmation and manage-booking | 25, 26 | Dynamic, token-gated, noindex |
| Host, ops, and admin | 39 to 56, 74 | Dynamic, authenticated, noindex, in their own route group and layout |

- **Patch ownership:** the framework's patch cadence is heavy (a server-component remote code execution in December 2025, two Critical advisories on 2026-10-14). The real job needs a named person and a response time inside the $8k monthly retainer. SEC-9 already blocks merges with a fixable advisory.

## What would change the call

- A walking-skeleton measurement (home and experience pages on a mid-range Android phone over throttled 4G) fails on Next.js and passes on an Astro prototype, with the gap traced to framework JavaScript: reconsider A3 for guest pages.
- Another critical `use cache` or server-component advisory: drop to the classic caching model (`force-cache` with `revalidate`), or reopen A2 or A3 if nobody can own patching.
- React Router's server-component mode becomes stable: A2 then matches A1 on the server-first default.
- The Perf Lab moves to its own repo: the router question stops mattering here.

## Open items raised by this research

- **Editorial authoring.** No R question covers how Ramble staff create and publish editorial content, Picks, home modules, and the gift guide (PRD-01, PRD-03, PRD-04, PRD-50, C-04). Folded into ADR 0005 on 2026-10-18 (an in-app editorial admin).
- **Crawler check.** Cache Components needs a test with a crawler user agent before launch (PRD-65).
- **Redirect volume** is unknown until the migration list exists (PRD-64); a large map uses the platform's bulk redirects, not a framework change.
