# R1: Framework and rendering

Researched 2026-10-18 for ADR R1.

Basis labels: [documented] a vendor or standards-body page I read; [reported] a third party; [inferred] my reasoning from documented facts; [unverified] I could not check it. [>12 mo] marks a source older than 12 months. Versions and dates are as read on 2026-10-18.

## Question

**Part A, framework.** Which framework and rendering model carries Ramble's guest site, host tools and ops admin? The build plan's starting point is Next.js App Router with React Server Components by default and `"use client"` as a justified exception. Weighed against React Router v8 framework mode and Astro 7 with React islands.

**Part B, router.** The Perf Lab brief (vault note `Projects/Personal/Ramble Perf Lab - Kickoff.md`, not in the repo) assumes the site mixes the App Router and the Pages Router, so a later performance branch can show navigation across that boundary. Does any PRD requirement justify mixing in the best-case build? What does adding a `pages/` area later, in a separate branch, cost?

**Real job versus demo.** The recommendation is for the real job. The demo runs the same stack. What it simulates: editorial content is seeded in the repo, not edited by staff in a CMS; the legacy-URL redirect map is a small sample; Core Web Vitals are lab runs only, so the field-data half of PRD-68 cannot be shown; the newsletter spike (PRD-70) is a synthetic load test; hosting may sit on Vercel's Hobby plan, which is for personal, non-commercial use ([Vercel pricing](https://vercel.com/pricing), undated), where the real job needs a paid plan (R7).

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-63 | A second city must not change any existing address. Framework-neutral (every option has file or config routing), so it constrains the URL plan in P3, not this choice. |
| PRD-64, G7 | Old URLs with organic traffic must redirect. Needs a redirect mechanism that scales to an unknown count (the legacy site is a hosted builder, so I could not enumerate it). |
| PRD-65 | Category, neighborhood and Ramble Picks pages must be indexable with editorial copy. Needs server or prerendered HTML. |
| PRD-66 | Experience pages carry structured data for rich results (Should, cut order 4). Needs a clean way to emit JSON-LD. |
| PRD-01, PRD-03, PRD-50 | Staff arrange home modules, Picks and the gift guide without a developer. Publishing must refresh cached pages without a redeploy. |
| PRD-68 | Core Web Vitals "good" at p75 on mobile (LCP 2.5 s, INP 200 ms, CLS 0.1) on home, browse and experience pages. Sets the client JavaScript budget and the image pipeline. |
| PRD-70 | Sized to 12,500 visitors in 3 hours after a send: about 1.2 visitors per second on average, about 7 per second if half arrive in the first 15 minutes [inferred, Q-20 open]. Static or cached reads keep the database for holds and checkouts. |
| PRD-09 to PRD-12 | Experience page with a sticky mobile booking bar and live spaces left. Mixes cached content with live availability. |
| PRD-14 to PRD-22 | Single-page checkout, holds with a visible timer, declines, sell-outs, no double charge. The most interactive surface. |
| PRD-39 to PRD-56, PRD-74 | Host dashboard, guest lists, ops tools, roles and audit. Application-shaped, behind sign-in, not indexed. |
| PRD-67 | iPhone Safari plus Instagram and mail in-app browsers. Pages must work under slow networks and late hydration. |
| PRD-72 | Card data never touches Ramble's servers. Met by the payment provider's hosted fields under any option (R3). |
| PRD-77 | One branded header and footer on every guest page. Strained if two routers render them separately. |
| C-01, C-02, C-04 | About $150k build, December 1 date, six people and no engineers. Favors one codebase, a large hiring pool, and a patch process someone owns. |
| C-09 | Demo constraint above. |

**Drivers that are not PRD IDs** (flagged, because an ADR should trace to the PRD): the Perf Lab decision of 2026-10-08 in `DECISIONS.md` (Ramble also carries the performance examples, in a later branch); BUILD-PLAN R1 row, which names Next.js App Router and "seam 1" as the starting point; Dave's standards, which are written for Next.js App Router. `STATUS.md` records that the router mix has no PRD driver.

## Options

**Versions on 2026-10-18**

| Product | Current | Notes |
|---|---|---|
| Next.js | 16.4.2 on npm ([registry](https://registry.npmjs.org/next/latest)); 16.4 released 2026-10-06 ([post](https://nextjs.org/blog/next-16-4)) | MIT. Node 20.9 or later. 16.4 ships React 19.3 (released 2026-09-09, [React blog](https://react.dev/blog/2026/09/09/react-19-3)). Active LTS is the 16.x major ([support policy](https://nextjs.org/support-policy), undated). |
| React Router | 8.4.0, 2026-09-15 ([changelog](https://reactrouter.com/changelog)) | MIT ([registry](https://registry.npmjs.org/react-router/latest)). v8.0.0 shipped 2026-06-17 and needs Node 22.22 or later, React 19.2.7 or later, Vite 7 or later. RSC mode is still labelled unstable. |
| Astro | 7.4.0, 2026-10-15 ([blog](https://astro.build/blog/)) | MIT ([registry](https://registry.npmjs.org/astro/latest)). Astro 7.0 shipped 2026-06-22 ([post](https://astro.build/blog/astro-7/)). Node 22.22 or later. `@astrojs/react` 7.1.0 ([docs](https://docs.astro.build/en/guides/integrations-guide/react/)). |
| TanStack Start | 1.0 stable, 2026-10-13 ([post](https://tanstack.com/blog/tanstack-start-1-0)) | Five days old. Not weighed (see below). |
| Dave's baseline | Next 16.3.8, React 19.2.x, checked 2026-10-06 ([standards](file:///Users/davidfleming/.claude/standards/react-nextjs.md)) | Behind. See Open risks 1. |

**Part A: framework**

### A1. Next.js App Router, RSC by default (the starting point)

**How it works.** Pages and layouts are Server Components; `'use client'` marks a boundary and the file's imports join the client bundle ([Next docs](https://nextjs.org/docs/app/getting-started/server-and-client-components), updated 2026-10-05). With Cache Components (`cacheComponents: true` plus `partialPrefetching: true`) a route prerenders a static shell, caches marked functions with `'use cache'`, `cacheLife` and `cacheTag`, and streams uncached parts behind `<Suspense>` ([caching](https://nextjs.org/docs/app/getting-started/caching), [config](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)). Next 16.4 recommends Cache Components for every app, makes it the `create-next-app` default, and says it becomes the default in Next 17 ([16.4 post](https://nextjs.org/blog/next-16-4)). Mutations use Server Actions, which work as plain form posts before JavaScript loads when the form is in a Server Component, and queue until hydration when it is in a Client Component ([mutating data](https://nextjs.org/docs/app/getting-started/mutating-data)).

**Fit to the PRD.**
- Serves PRD-63 to PRD-66. Google calls server-side or pre-rendering a great idea ([Google](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), undated), and A1 renders HTML on the server. Built in: Metadata API, a `sitemap.ts` convention ([docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)), a JSON-LD guide with an XSS-safe serialization note ([docs](https://nextjs.org/docs/app/guides/json-ld)), and `redirects` in config with 308 for permanent ([docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects)).
- Serves PRD-01, PRD-03, PRD-50. Tag-based revalidation (`cacheTag`, `revalidateTag`, `updateTag`) lets a staff publish refresh cached pages without a deploy ([caching](https://nextjs.org/docs/app/getting-started/caching), [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)).
- Serves PRD-68 and PRD-70. Server Components reduce JavaScript sent to the browser ([docs](https://nextjs.org/docs/app/getting-started/server-and-client-components)). The static shell can be served from a CDN. `next/image` has a `preload` prop for the LCP image ([docs](https://nextjs.org/docs/app/api-reference/components/image)). 16.4 adds `ensureStatic`, which fails the build if a dynamic component enters a route marked static ([16.4 post](https://nextjs.org/blog/next-16-4)). Instant navigations and partial prefetching are available behind the same flags ([16.3 post](https://nextjs.org/blog/next-16-3-instant-navigations)).
- Serves PRD-14 to PRD-22, with one gap. Forms keep working before hydration. The client dispatches Server Actions one at a time, which narrows but does not remove a double submit ([mutating data](https://nextjs.org/docs/app/getting-started/mutating-data)). The framework supplies no idempotency, so PRD-22 rests on an app-level key (standards FORM-8) [inferred].
- Serves PRD-39 to PRD-56 and PRD-74. One framework and one auth pattern for guest, host and ops. Server Functions are public POST endpoints, so each must check auth ([docs](https://nextjs.org/docs/app/getting-started/mutating-data)).
- Strains C-04 through patch cadence (Risks below) [inferred].
- Fits the standards directly. `react-nextjs.md` has 156 rules; 43 cite nextjs.org in the source column; the 11 RSC rules are Server Component rules; 5 of the 14 architecture-audit rows (B8, A1 to A4) are App Router constructs [counted from the local files].

**Cost.** No license fee (MIT). Hosting and CI are R7. Off Vercel, the Adapter API is stable since 16.2 and the Vercel adapter is open source; Netlify, Cloudflare and AWS (OpenNext) adapters were still in development in March 2026 ([post](https://nextjs.org/blog/nextjs-across-platforms)); their current state [unverified]. Next.js has 269.8 million npm downloads in the last month ([npm API](https://api.npmjs.org/downloads/point/last-month/next), 2026-09-17 to 2026-10-16), the largest pool of the three.

**Risks.**
- Security record, from the vendor's own posts. 2025-12-03: CVSS 10.0 remote code execution in the RSC protocol, App Router only, Pages Router not affected ([advisory](https://nextjs.org/blog/CVE-2025-66478)). 2026-09-30: one High and five Medium advisories, two of them in `use cache` ([release](https://nextjs.org/blog/september-2026-security-release)). 2026-10-14: two Critical (remote code execution in `use cache` functions that return typed arrays, no workaround; remote code execution in the Image Optimization API with SVG) and one High (denial of service with Server Actions), fixed in 16.4.1 ([update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)). The post names 16.4.1 and 15.5.28 as the fixed lines; it does not say whether 16.3.8 is affected, so treat it as affected [inferred].
- Cache Components is young. 16.4 says earlier versions could not meet the cost and performance guarantees in some cases and that 16.4 closes those gaps ([post](https://nextjs.org/blog/next-16-4)). Three advisories in `use cache` were published within two weeks (2026-09-30 and 2026-10-14, above).
- Bots. With Cache Components, HTML-limited bots skip the prerendered shell and get a dynamic render; a shell that depends on build-only data can fail for a crawler while loading for a person ([streaming guide](https://nextjs.org/docs/app/guides/streaming), updated 2026-10-15). Needs a test with a bot user agent (PRD-65).
- Measurement. Next 16 dropped `First Load JS` from `next build` output as inaccurate under RSC ([upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)), so PRD-68 budgets need Lighthouse and field data, plus the Turbopack bundle analyzer ([16.4 post](https://nextjs.org/blog/next-16-4)).
- Vendor gravity. Next.js is built by Vercel; the stable Adapter API and a working group with Netlify, Cloudflare, AWS and Google Cloud reduce but do not remove that ([post](https://nextjs.org/blog/nextjs-across-platforms)).

**Evidence.** Vendor docs, release posts and advisories (all dated 2026). No independent performance comparison found (see A3).

### A2. React Router v8, framework mode

**How it works.** A Vite plugin adds file or config routes, `loader`, `action`, `meta` and `headers` exports per route, SSR with streaming, static pre-rendering from a URL list, or SPA mode ([modes](https://reactrouter.com/start/modes), [rendering](https://reactrouter.com/start/framework/rendering)). Server Components exist as an opt-in that the docs label experimental, with breaking changes allowed in minor and patch releases ([RSC page](https://reactrouter.com/how-to/react-server-components)). Deploys to Vercel with a preset ([Vercel docs](https://vercel.com/docs/frameworks/frontend/react-router), updated 2026-09-16).

**Fit to the PRD.**
- PRD-63 to PRD-66 are adequate, with two gaps. `meta` covers title, description, canonical, Open Graph and JSON-LD ([docs](https://reactrouter.com/how-to/meta)). The docs show no sitemap helper; resource routes can serve one, but the page has no sitemap example ([docs](https://reactrouter.com/how-to/resource-routes)). Caching is HTTP `Cache-Control` with `stale-while-revalidate` ([Vercel docs](https://vercel.com/docs/frameworks/frontend/react-router)); I found no tag-based invalidation, so a staff publish waits for a cache window or a redeploy [inferred]. That strains PRD-01 and PRD-03.
- PRD-68 is strained. Without the unstable RSC mode every route component is a client component, so there is no server-only component to keep out of the bundle [inferred from the RSC page]. The docs I read show no image or font component. Vercel's image-optimization quickstart lists Next.js, Nuxt and Astro, not React Router ([Vercel docs](https://vercel.com/docs/image-optimization)), so images would need a custom loader [inferred].
- PRD-14 to PRD-22 are strong. Forms and links work before JavaScript loads, actions handle submits, `useFetcher` gives pending state without navigation ([docs](https://reactrouter.com/explanation/progressive-enhancement)). Equal to A1 here and with a smaller mental model (no server/client boundary) [inferred]. No built-in idempotency either.
- PRD-39 to PRD-74 are strong. Server-side access control is the app's job, as in A1; v8.4.0 added docs saying every RSC server function must do its own ([changelog](https://reactrouter.com/changelog)).
- Fit with standards is poor on the Next-specific rules (43 cite Next docs). The RSC rules, the Next-specific DATA, UI and SET rules, and architecture-audit B8 and A1 to A4 do not apply. The `lib/` and `components/` layers port unchanged [inferred]. Seam 1 as the build plan words it (RSC by default) cannot be shown with stable APIs [inferred].

**Cost.** MIT. Same hosting as A1. 241.1 million npm downloads last month ([npm API](https://api.npmjs.org/downloads/point/last-month/react-router)); most of that is library-mode and transitive use, so it does not measure framework-mode adoption [inferred].

**Risks.** Major version churn: v8.0.0 removed `react-router-dom`, made the package ESM-only and raised the Node, React and Vite floors ([changelog](https://reactrouter.com/changelog)). Advisories on 2026-06-02 and 2026-07-22 include High items (denial of service in the `__manifest` endpoint, potential remote code execution chained onto prototype pollution) ([advisories](https://github.com/remix-run/react-router/security/advisories)); affected packages were not shown on the list page.

**Evidence.** Vendor docs. No performance data found.

### A3. Astro 7 with React islands

**How it works.** Pages render to HTML and CSS with no client JavaScript; a `client:*` directive turns a component into an island; `server:defer` renders slow parts as server islands ([islands](https://docs.astro.build/en/concepts/islands/)). Static by default; per-page `prerender = false` renders on demand with an adapter ([on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)). Astro 7 made route caching stable (`Astro.cache`, `routeRules`, `cache.invalidate()`); CDN cache providers for Vercel, Netlify and Cloudflare are experimental ([Astro 7](https://astro.build/blog/astro-7/)). On Vercel, ISR is available with on-demand invalidation by bypass token ([adapter docs](https://docs.astro.build/en/guides/integrations-guide/vercel/)).

**Fit to the PRD.**
- PRD-63 to PRD-66 and PRD-01 are strong for editorial pages. Static HTML, a `redirects` map with a 301 default and no stated limit ([routing docs](https://docs.astro.build/en/guides/routing/)). Gap: the sitemap integration cannot emit entries for on-demand routes ([docs](https://docs.astro.build/en/guides/integrations-guide/sitemap/)), so experience pages with live availability need a hand-built sitemap [inferred].
- PRD-68 is the strongest case on content pages: zero JavaScript by default ([docs](https://docs.astro.build/en/concepts/islands/)). On the experience page the booking panel is one island, and checkout is one large island, so the advantage narrows exactly where PRD-14 to PRD-22 live [inferred]. Built-in `<Image>` and `<Picture>` with Sharp; the docs do not document an LCP preload or priority option ([docs](https://docs.astro.build/en/guides/images/)). Vercel image optimization supports Astro ([Vercel docs](https://vercel.com/docs/image-optimization)).
- PRD-14 to PRD-22 are adequate. Each island is isolated; React context does not cross islands and Astro recommends Nano Stores for shared state ([recipe](https://docs.astro.build/en/recipes/sharing-state-islands/)). PRD-11's sticky bar and the date picker would have to live in one island or share a store [inferred]. Astro Actions have a no-JavaScript form path, but only on on-demand pages ([docs](https://docs.astro.build/en/guides/actions/)); `withState` bridges React's `useActionState` ([docs](https://docs.astro.build/en/guides/integrations-guide/react/)).
- PRD-39 to PRD-74 are a strain. Host dashboards, guest-list tables and ops forms are application-shaped; under islands they become React apps inside islands [inferred].
- Standards. The layer rules (`lib/`, synchronous `components/`, thin shells) port; `.astro` pages play the async-shell role. The RSC, Next-specific DATA and UI rules, and architecture-audit B8 and A1 to A4 do not apply [inferred]. Seam 1 can still be shown through `client:*` as the exception.

**Cost.** MIT. The Astro team joined Cloudflare on 2026-01-16; Astro stays MIT, keeps open governance and multi-platform support ([post](https://astro.build/blog/joining-cloudflare/)). 27.9 million npm downloads last month ([npm API](https://api.npmjs.org/downloads/point/last-month/astro)), about a tenth of Next.js.

**Risks.** Astro 7 is four months old. Advisories include a Critical remote code execution through AVIF image optimization (2026-08-27) and a moderate SSRF in the default image endpoint (2026-10-12) ([advisories](https://github.com/withastro/astro/security/advisories)). The React integration page does not state supported React versions [unverified].

**Evidence.** Vendor docs. The only performance comparison I found is Astro's own 2023 report using CrUX and HTTP Archive: over 50% of Astro sites passed Core Web Vitals against roughly 1 in 4 for Next.js, with the authors noting homepages only, older Next.js sites in the sample, and that correlation with JavaScript payload does not prove framework choice causes the gap ([report](https://astro.build/blog/2023-web-framework-performance-report), 2023-03-07 [>12 mo], vendor-authored). The current HTTP Archive dashboard has no extractable per-framework numbers ([dashboard](https://httparchive.org/reports/cwv-tech)) [unverified].

### Also considered, not weighed

| Candidate | Why not |
|---|---|
| TanStack Start 1.0 | Stable five days ago, on 2026-10-13 ([post](https://tanstack.com/blog/tanstack-start-1-0)). RSC arrives as an integration; the team stopped using RSC on its own site. Too new for a December 1 date with no engineers on the client side. |
| Astro for content plus Next.js for booking | Two apps, two upgrade streams, and a hard navigation on the funnel's key step (experience page to checkout), the same cost Part B describes [inferred]. |
| Client-only SPA | Google queues pages for rendering, and not every bot runs JavaScript, so it still advises server-side or pre-rendering ([Google](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)). Puts PRD-65 and PRD-68 at risk. |

**Part B: router**

### B1. App Router only

**How it works.** All routes in `app/`. One router, one navigation model, one metadata system.

**Fit to the PRD.** Serves PRD-68 and PRD-14 to PRD-22: instant navigations and partial prefetching apply to every funnel step ([16.3 post](https://nextjs.org/blog/next-16-3-instant-navigations)). Serves PRD-77, PRD-65 and PRD-66 with one header and one metadata system, and C-04 with one mental model. Strains nothing in the PRD. Does not give the Perf Lab its router boundary.

**Cost.** None beyond A1.

**Risks.** The Perf Lab needs the boundary later (B3 covers it).

**Evidence.** [Migration guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration) (updated 2026-09-28) and the Next.js 16.3 post above.

### B2. Mix App Router and Pages Router from the start

**How it works.** The two routers coexist in one app ([migration guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration), updated 2026-09-28). Moving between routes served by different routers is a hard navigation, and `next/link` does not prefetch across routers. Vercel suggests Speculation Rules (Chrome, Edge and Opera only) with `<link rel="prefetch">` as the fallback ([Vercel guide](https://vercel.com/guides/optimizing-hard-navigations), 2025-11-10).

**Fit to the PRD. No requirement justifies it.**

| Candidate reason | Checked against | Result |
|---|---|---|
| Keep legacy pages while migrating (PRD-64) | Redirects are config or proxy, not a router ([docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects)). The build is greenfield. | No |
| Second city (PRD-63) | Pages Router i18n is locale routing; a second city is a URL segment. The migration guide says the built-in i18n features are no longer needed in `app` ([guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration)). | No |
| Smaller attack surface on checkout (PRD-72) | The Pages Router was not affected by the RSC remote code execution or the Server Actions denial of service ([advisory](https://nextjs.org/blog/CVE-2025-66478), [update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)). App Router routes still run on the same server, so the exposure stays. Card data never touches the server anyway (PRD-72 is met by hosted fields). | No |
| Performance (PRD-68, PRD-70) | Pages in `pages/` are Client Components ([guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration)). Cache Components is documented for the App Router only, and I read no primary statement on `pages/` routes [unverified]. | No, it is worse [inferred] |

**What it strains.** PRD-68 and PRD-14 to PRD-22: a full document load between listing, experience and checkout, with no instant navigation across the boundary. PRD-77: root-layout styles do not apply to `pages/*`, so the header is built twice ([guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration)). PRD-65 and PRD-66: `next/head` in `pages/` against the Metadata API in `app/` gives two places to get tags wrong. C-04: two mental models for a client with no engineers.

**Cost.** Header and metadata work twice, from day one, plus a Departure in `stack-decisions.md` for the `pages/` area.

**Risks.** The Pages Router had its own advisory in September (SSG/ISR cache poisoning, self-hosted only, [release](https://nextjs.org/blog/september-2026-security-release)). The docs call it still supported but recommend the App Router ([Pages Router docs](https://nextjs.org/docs/pages), updated 2025-04-15 [>12 mo]). I found no end-of-life date; a search surfaced only third-party blogs and an open GitHub discussion on long-term fixes ([discussion](https://github.com/vercel/next.js/discussions/56655), title only) [unverified].

**Evidence.** Next.js docs and advisories above.

### B3. App Router only now; add a `pages/` area in the performance branch

**How it works.** The best-case build is B1. The performance branch cuts from it and moves the leaf routes the brief names (`/search`, `/checkout`) into `pages/`, leaving `/experiences/[id]` in `app/`. The brief already puts the problems in a separate branch of the same repo ([decision 2026-10-08](../../plan/DECISIONS.md)).

**Fit to the PRD.** Same as B1 for the shipped build. The branch is outside the PRD.

**Cost to add later** [inferred from the migration guide unless linked]:
1. Route files. Create `pages/` and delete the matching `app/` route; the same URL in both is a build error ([mirror of the Next.js test suite](https://git.devminer.xyz/archive/rsnext/src/commit/93aac0e39b958c11ac6e5ab27ef58c6d15ec92da/test/e2e/conflicting-app-page-error), not an official docs page) [unverified in primary docs].
2. Shell files. Add `_app` and `_document`; global CSS may only be imported in `_app`. Root-layout styles do not reach `pages/*`.
3. Data. `getServerSideProps` or `getStaticProps` replace async Server Components, and the page is a Client Component. Call the same `lib/` service modules from them.
4. Navigation hooks. `next/router` in `pages/`, `next/navigation` in `app/`. Shared components can use `next/compat/router`.
5. Head tags. `next/head` replaces the Metadata API on those routes.
6. Header parity. Same markup and CSS on both sides, or the Perf Lab's issue 11 appears by accident in the baseline.
7. Standards. Record a Departure in the branch's `stack-decisions.md`: the RSC rules, architecture-audit B8 and A1 to A4, and `next typegen` page props do not cover `pages/`.
8. Time. Roughly one to two days for two routes plus header parity, in the branch and not the best-case build [inferred, not measured].

**No-regret choices in the best-case build.** All already required by the standards, so they cost nothing:
- Header, footer and cards are synchronous components with no router hooks (ARCH-5).
- Every decision lives in `lib/`, and data comes from service modules that a `getServerSideProps` can also call (ARCH-1, ARCH-2).
- Router hooks sit in thin client islands, not deep in shared components.
- In P3, avoid parallel or intercepting routes on the browse and checkout routes (a filter drawer built as an intercepting route, for example). Those are App Router features and would be rewritten when the route moves [inferred].
- The brief's route names are its own. P3 should make browse and checkout leaf routes so the boundary can be drawn there [inferred].

**Risks.** The branch's Pages Router code inherits the September advisory class above if self-hosted. The lab's own claims (bfcache reasons, Speculation Rules eagerness, cross-document view transitions) are marked "to verify" in the brief and were not researched here.

**Evidence.** Migration guide, Vercel guide, brief.

## Comparison

**Part A.** Ratings: Strong, Adequate, Strain.

| Criterion (PRD) | A1 Next.js App Router | A2 React Router v8 | A3 Astro 7 + React |
|---|---|---|---|
| Indexable editorial pages (PRD-63 to PRD-66, PRD-01, PRD-03) | Strong: metadata, sitemap, JSON-LD, tag revalidation | Adequate: `meta` incl. JSON-LD; no sitemap helper or tag invalidation found | Strong: static default, redirects, route caching; sitemap gap for on-demand routes |
| Mobile JavaScript floor (PRD-68, PRD-70) | Adequate: RSC default, CDN shells; unmeasured | Strain: whole-route hydration [inferred]; RSC unstable | Strong on content pages; Adequate on booking and checkout islands |
| Image and font pipeline (PRD-68) | Built in, `preload` for LCP | None found; custom loader [inferred] | Built in (Sharp); no documented LCP preload |
| Booking interactivity (PRD-14 to PRD-22) | Strong; idempotency is app code | Strong; idempotency is app code | Adequate: islands, shared state via Nano Stores |
| Host and ops surfaces (PRD-39 to PRD-56, PRD-74) | Strong | Strong | Strain [inferred] |
| Maintainable with no client engineers (C-01, C-04) | Adequate: largest pool; heaviest patch cadence | Adequate: smaller surface; v8 churn | Adequate: smaller pool; Cloudflare-employed team |
| Fit with Dave's standards | Direct | Next-specific rules (43 cite Next docs) and 5 audit rows replaced | Layers port; RSC and Next rules replaced |
| Perf Lab (not a PRD) | Required for its issues 1 to 12 | No | No |
| Maturity | Cache Components young; 3 `use cache` advisories in 2 weeks | RSC unstable | v7 four months old |
| License and cost | MIT; hosting in R7 | MIT; hosting in R7 | MIT; hosting in R7 |

**Part B.**

| Criterion | B1 App Router only | B2 Mix from the start | B3 App now, `pages/` in the perf branch |
|---|---|---|---|
| PRD justification | n/a | None found | n/a |
| Funnel navigation (PRD-68, PRD-14 to PRD-22) | Instant navigations throughout | Hard navigation at each boundary | Instant in the best-case build; hard in the branch (intended) |
| Brand and SEO consistency (PRD-77, PRD-65, PRD-66) | One header, one metadata system | Two of each | One in the best-case build |
| Maintainability (C-04) | One model | Two models | One model in the shipped build |
| Standards | Fully covered | Departure for `pages/` | Departure in the branch only |
| Perf Lab | Not available | Available now | Available in the branch |
| Cost now | None | Header and metadata twice | None |
| Cost later | n/a | n/a | About 1 to 2 days [inferred] |

## Recommendation

**Part A: A1, Next.js App Router with Server Components by default.** Confidence moderate. The case rests on documented fit with the requirements and with the standards, not on a measured performance win; no independent comparison exists. The editorial half of the site (PRD-63 to PRD-66) is where A3 is best, so A3 is the strongest rival. It loses on the application half (PRD-14 to PRD-22, PRD-39 to PRD-74), on the standards rewrite, and on the Perf Lab, and the split that would capture both costs a hard navigation on the funnel's key step. A2 gives up the server-component default that seam 1 names.

Specific settings to carry into the ADR:
- **Version.** Next 16.4.x, at least 16.4.1 (npm latest is 16.4.2), React 19.3. Ask Dave to move the standards baseline off 16.3.8 before the walking skeleton (Risk 1).
- **Caching model (DATA-10).** `cacheComponents: true` and `partialPrefetching: true`. It is the vendor's recommended model, the default in the next major, and what makes the static shell, tag revalidation and instant navigation work. Condition: a named owner for patches (Risk 2). The alternative, `force-cache` with `revalidate`, avoids the youngest code but leads to a migration at Next 17.
- **Rendering by surface.**

| Surface | PRD | Rendering |
|---|---|---|
| Home, Ramble Picks, gift guide, category and neighborhood pages, guide pages | 01, 03, 04, 13, 65 | Cached shell with `'use cache'` and `cacheTag`; staff publish revalidates tags; metadata and JSON-LD in server HTML; `ensureStatic` on pages with no live data |
| Browse and filter | 02, 05 | Filters in the URL; cached results with a short `cacheLife`; filter combinations beyond category and neighborhood marked noindex (policy for P3) |
| Experience page | 09 to 12, 66 | Cached shell for copy, photos, host, terms; spaces left and dates in `<Suspense>` with reserved space; booking bar as one client island |
| Checkout | 14 to 22 | Dynamic, uncached, noindex; client island for the payment element and hold timer; Server Action with an idempotency key |
| Confirmation, manage-booking | 25, 26 | Dynamic, token-gated, noindex |
| Host, ops, admin | 39 to 56, 74 | Dynamic, authenticated, noindex; own route group and layout |

**Part B: B3.** No PRD requirement justifies mixing routers. The best-case build is App Router only. Add a `pages/` area in the Perf Lab branch. It costs about one to two days there [inferred], and the no-regret choices above keep it that cheap.

**Decisions for Dave:** (1) accept A1; (2) bump the standards baseline to Next 16.4.x and React 19.3; (3) DATA-10 answer; (4) router answer; (5) add an ADR for the editorial authoring tool, which no R-row covers (Risk 5).

## What would change the call

- A walking-skeleton measurement (home and experience page on a mid-range Android phone, throttled 4G, PRD-68's lab setup) fails on Next.js and passes on a comparable Astro prototype, and the gap traces to framework JavaScript rather than images or third-party scripts. Then reconsider A3 for guest pages.
- Dave drops the Perf Lab and seam 1 as constraints and accepts rewriting the standards. A2 and A3 then compete on merits; A3 wins if the editorial share of traffic and effort dominates.
- Another critical `use cache` or RSC advisory. Then reconsider the classic caching model, or A2/A3 if no one can own patching under C-01's $8k a month.
- React Router's RSC mode loses its unstable label. A2 then matches A1 on the server-component default.
- A requirement appears that only the Pages Router can meet (a library that supports `next/router` alone). None found; then B2 for that route only.
- The Perf Lab moves to its own repo. Part B stops mattering for Ramble.
- The redirect map is large (thousands). That changes the redirect mechanism (Vercel Bulk Redirects, [docs](https://vercel.com/docs/redirects)), not the framework.

## Open risks

1. **Standards baseline is stale.** It says Next 16.3.8 and React 19.2.x, checked 2026-10-06. 16.4 shipped on 2026-10-06, 16.4.1 patches two Critical issues, and the support policy lists 16.x as Active LTS without saying older minors get fixes ([policy](https://nextjs.org/support-policy)). Standards rule 12 says stay on a patched release.
2. **Patch ownership under C-04.** The Next.js blog index lists security posts on 2025-12-03, 2025-12-11, 2026-09-30 and 2026-10-14 ([index](https://nextjs.org/blog)), two of them in the last three weeks. A client with no engineers needs a named patcher and a response time inside the retainer. I did not audit all React Router and Astro advisories; both have had High or Critical items in the last five months (links above), so patch burden is not unique to A1.
3. **No measured performance data.** PRD-68 is unproven for every option. A one-day measurement in the walking skeleton settles it. The HTTP Archive per-framework figures were not extractable.
4. **Cache Components behavior for crawlers** needs a test with a bot user agent before launch (PRD-65), because a shell that depends on build-time data can break for HTML-limited bots.
5. **No ADR covers the editorial authoring tool** (PRD-01, PRD-03, PRD-50, C-04). The R-table has no CMS row, and the R8 row covers seed content only. Payload runs inside a Next.js app and supports Postgres and MongoDB ([docs](https://payloadcms.com/docs/getting-started/what-is-payload), v3 docs; license not stated on the page [unverified]); other CMS options were not researched.
6. **Redirect volume unknown** (PRD-64, G7). Vercel documents config redirects for wildcards and Bulk Redirects for many thousands of simple ones ([docs](https://vercel.com/docs/redirects), updated 2026-09-18); the numeric limit on config redirects was not on the pages I read [unverified].
7. **Newsletter traffic (Q-20) unresolved**, so PRD-70's 12,500 and 2,200 estimates stay open; the rate figures above are arithmetic on the higher estimate.
8. **In-app browsers (PRD-67)** were not researched; late hydration and Apple Pay in those browsers belong to R3 and the P5 test plan.
9. **Pages Router `pages/` and Cache Components.** The primary docs describe Cache Components for the App Router only. A Vercel-authored agent skill file, seen only through a search summary, says the flag does not affect `pages/` routes ([skill listing](https://www.skills.sh/vercel-labs/next.js/next-cache-components-adoption), secondary); I did not read a primary statement [unverified].
10. **Off-Vercel hosting for Next.js** depends on adapters whose status I did not recheck after March 2026 (R7).

## Sources

All fetched 2026-10-18. Dates in parentheses are the page's own date where it shows one.

**Local files**
- PRD: `/Users/davidfleming/Workspace/ramble/docs/product/PRD.md` (v1.0, signed off 2026-10-18)
- Build plan: `/Users/davidfleming/Workspace/ramble/docs/plan/BUILD-PLAN.md`; status: `docs/plan/STATUS.md`; decisions: `docs/plan/DECISIONS.md`
- Standards: `~/.claude/standards/react-nextjs.md`, `architecture.md`, `stack-decisions.md`
- Perf Lab brief: vault note `Projects/Personal/Ramble Perf Lab - Kickoff.md` (2026-10-08)

**Next.js and Vercel**
- [Next.js 16.4](https://nextjs.org/blog/next-16-4) (2026-10-06); [Next.js 16.3: Instant Navigations](https://nextjs.org/blog/next-16-3-instant-navigations) (2026-06-25); [Across Platforms: Adapters](https://nextjs.org/blog/nextjs-across-platforms) (2026-03-25); [blog index](https://nextjs.org/blog)
- Security: [CVE-2025-66478](https://nextjs.org/blog/CVE-2025-66478) (2025-12-03); [September 2026 release](https://nextjs.org/blog/september-2026-security-release) (2026-09-30); [October 14 update](https://nextjs.org/blog/nextjs-security-update-october-14-2026) (2026-10-14)
- Docs: [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) (2026-10-05); [Caching](https://nextjs.org/docs/app/getting-started/caching) (2026-10-06); [cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) (2026-10-15); [Mutating data](https://nextjs.org/docs/app/getting-started/mutating-data) (2026-10-15); [Streaming](https://nextjs.org/docs/app/guides/streaming) (2026-10-15); [Version 16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16) (2026-10-15); [App Router migration, incl. using both routers](https://nextjs.org/docs/app/guides/migrating/app-router-migration) (2026-09-28); [Image](https://nextjs.org/docs/app/api-reference/components/image) (2026-09-28); [redirects](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects) (2026-06-30); [sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) (2026-08-18); [JSON-LD](https://nextjs.org/docs/app/guides/json-ld) (2026-03-02); [Pages Router](https://nextjs.org/docs/pages) (2025-04-15 [>12 mo]); [support policy](https://nextjs.org/support-policy) (undated)
- [npm: next](https://registry.npmjs.org/next/latest); [downloads](https://api.npmjs.org/downloads/point/last-month/next)
- [Vercel: optimizing hard navigations](https://vercel.com/guides/optimizing-hard-navigations) (2025-11-10); [Vercel: React Router](https://vercel.com/docs/frameworks/frontend/react-router) (2026-09-16); [Vercel: image optimization](https://vercel.com/docs/image-optimization) (2026-08-13); [Vercel: redirects](https://vercel.com/docs/redirects) (2026-09-18); [Vercel pricing](https://vercel.com/pricing) (undated)
- [React 19.3](https://react.dev/blog/2026/09/09/react-19-3) (2026-09-09)
- Secondary, not official docs: [Next.js test suite mirror](https://git.devminer.xyz/archive/rsnext/src/commit/93aac0e39b958c11ac6e5ab27ef58c6d15ec92da/test/e2e/conflicting-app-page-error) (app and pages route conflict error); [skill listing](https://www.skills.sh/vercel-labs/next.js/next-cache-components-adoption) (Cache Components and `pages/`)

**React Router**
- [Modes](https://reactrouter.com/start/modes); [rendering](https://reactrouter.com/start/framework/rendering); [meta](https://reactrouter.com/how-to/meta); [resource routes](https://reactrouter.com/how-to/resource-routes); [progressive enhancement](https://reactrouter.com/explanation/progressive-enhancement); [RSC (unstable)](https://reactrouter.com/how-to/react-server-components); [changelog](https://reactrouter.com/changelog) (v8.4.0, 2026-09-15; first 100,000 of 301,493 characters read)
- [Advisories](https://github.com/remix-run/react-router/security/advisories) (first page only); [npm](https://registry.npmjs.org/react-router/latest); [downloads](https://api.npmjs.org/downloads/point/last-month/react-router)

**Astro**
- [Islands](https://docs.astro.build/en/concepts/islands/); [React integration](https://docs.astro.build/en/guides/integrations-guide/react/); [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/); [Actions](https://docs.astro.build/en/guides/actions/); [Vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/); [images](https://docs.astro.build/en/guides/images/); [sharing state](https://docs.astro.build/en/recipes/sharing-state-islands/); [routing and redirects](https://docs.astro.build/en/guides/routing/); [sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)
- [Astro 7](https://astro.build/blog/astro-7/) (2026-06-22); [joining Cloudflare](https://astro.build/blog/joining-cloudflare/) (2026-01-16); [blog index](https://astro.build/blog/); [2023 web framework performance report](https://astro.build/blog/2023-web-framework-performance-report) (2023-03-07 [>12 mo], vendor-authored)
- [Advisories](https://github.com/withastro/astro/security/advisories) (first page only); [npm](https://registry.npmjs.org/astro/latest); [downloads](https://api.npmjs.org/downloads/point/last-month/astro)

**Other**
- [TanStack Start 1.0](https://tanstack.com/blog/tanstack-start-1-0) (2026-10-13; first 100,000 of 122,780 characters read)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) (undated)
- [web.dev: Web Vitals](https://web.dev/articles/vitals) (2024-10-31 [>12 mo]; thresholds match PRD-68)
- [HTTP Archive CWV Technology Report](https://httparchive.org/reports/cwv-tech) (dashboard; no extractable numbers)
- [Payload CMS: what is Payload](https://payloadcms.com/docs/getting-started/what-is-payload) (3.x docs)
- Search result for Pages Router status: [GitHub discussion 56655](https://github.com/vercel/next.js/discussions/56655) (title only; not read)

**Not verified:** per-framework Core Web Vitals or first-load JavaScript for current versions; the Pages Router's end-of-life policy; Cache Components behavior on `pages/` routes from a primary doc; the numeric limit on Vercel config redirects; the current state of non-Vercel Next.js adapters; Stack Overflow and State of JS usage data (not fetched); the React Router and Astro advisory lists beyond their first page.
