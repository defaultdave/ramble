---
title: Ramble unit scores (P4 artifact 3)
status: approved 2026-10-18 (Dave), with the spike plan as recommended and Tiptap
date: 2026-10-18
author: ramble-pm
record: docs/plan/units.yaml (complexity, uncertainty, spike, spike_question)
---

# Unit scores

Every unit in the approved breakdown has a **complexity** score and an **uncertainty** score, 1 to 3 each, kept separate on purpose: a big unit that is well understood is safer than a small unknown one (planning method). A unit with uncertainty 3 gets a spike before it gets an estimate.

## How the scores were made

- **Independent panel.** Four estimators scored every unit without seeing each other's scores, each from a different angle: a Next.js full-stack engineer; a data and payments engineer; a front-end and design-system engineer; a delivery lead who knows how agent-built units go wrong. The PM did not score first, so nothing anchored them.
- **Rubric.** Complexity: 1 one focused change, 2 several layers or states, 3 intricate logic (concurrency, money, state machines) or a lot of surface. Uncertainty: 1 done many times before, 2 some unknowns, 3 approach unproven or waiting on an outside answer, size could be off by a factor of two.
- **Moderation.** 5 units had a two-point spread on an axis or a split on whether a spike was needed; a moderator settled each on the merits of the rationales, not by vote. Everything else takes the panel median, rounded up.
- **Caveat.** All four estimators are the same model family with different briefs, so they share priors. 77 of 132 units got identical scores from all four, which overstates how independent the panel was. The useful signal is where any estimator dissented, and Dave's own read of the uncertainty-3 and complexity-3 units below. The estimate (artifact 6) keeps this in its ranges.

## Distribution

| | Uncertainty 1 | Uncertainty 2 | Uncertainty 3 | Total |
|---|---|---|---|---|
| **Complexity 1** | 19 | 7 | 1 | 27 |
| **Complexity 2** | 28 | 47 | 5 | 80 |
| **Complexity 3** | 1 | 24 | 2 | 27 |
| **Total** | 48 | 78 | 8 | 134 |

> **Updated 2026-10-19:** the artifact 4 graph review added two units, U-116 (caller and role contract) and U-117 (rich-text format and renderer). The PM scored both C1 U1; the panel did not score them.

## Uncertainty 3: spikes and wide ranges

> **Decided 2026-10-18 (Dave):** spikes for U-013, U-028, and one combined Cache Components spike for U-008a and U-009; wide ranges for U-093, U-101, U-046, U-096. Tiptap for the editorial rich text.

| Unit | C | Spike? | The question | Recommendation |
|---|---|---|---|---|
| U-008a CSP and security headers | 2 | yes | On Next 16.4.1 with Cache Components on Vercel, can the proxy set a nonce CSP on fully dynamic routes (ops, checkout, manage) and a report-only CSP on cached and partially prerendered routes (experience shell, category pages) without the nonce read in a shared layout pushing… | Run in P4, combined with U-009 as one Cache Components spike, locally with `next start`. |
| U-009 Cache conventions and tag map | 2 | yes | Cache Components is young: cacheLife, cacheTag, updateTag vs revalidateTag semantics and degraded-mode fallbacks on Vercel are unproven here. Spike: tag invalidation and runtime caching behave as designed on Hobby? | Run in P4, combined with U-008a. The Vercel-only runtime cache part needs a preview deploy (Dave's gate) or moves to the walking skeleton. |
| U-013 Concurrency spike on Neon | 2 | yes | It is the spike: row-lock behavior through Neon pooler vs HTTP driver under parallel reserves is unknown and determines the driver for every money path. | Run in P4 (planned). Needs a Neon project, which Dave creates; a local Postgres run proves the lock logic but not the Neon driver. |
| U-028 Code Connect spike | 1 | yes | Untried Code Connect CLI workflow and a published Figma library prerequisite; the spike exists to size U-029. | Run in P4 (planned). Needs the Figma library published (Blocked on Dave). |
| U-046 Stripe Connect adapter | 3 | no | Separate charges and transfers, Connect onboarding, Radar, balance-transaction fee timing, webhook ordering; never run here. Spike: does a test-mode SCT flow match the port's fee and transfer assumptions? | No spike: real job only, not built. Estimated with a wide range. |
| U-093 Redirect map and guide import | 2 | yes | From the client's current hosted site builder and Search Console, can we get a complete page list with 12 months of search visits and the guide content in a format we can parse, and does one sample guide convert cleanly into a guide entry with… | No spike: the demo has no real old site to export. Carry as a real-job assumption with a wide range; the demo uses a simulated page list. |
| U-096 Load test | 3 | no | Four scenarios including hold hoarding and mass cancellation hitting locks, outbox, and refunds. Self-hosted Next 16 on a Neon branch may not represent Vercel; findings drive unbounded fix… | No spike: the load test is itself the measurement. Wide range. |
| U-101 Device matrix and wallets | 2 | yes | Spike: do Better Auth passkeys and checkout work in Instagram and mail in-app webviews? Also unclear what an Apple Pay check proves against a fake gateway. | No spike now: needs real phones and a deployed preview, and the fake gateway can't show wallets. Carry as a wide range; check on Dave's phones once a preview exists. |

## Complexity 3: the heavy units

27 units score complexity 3. They carry most of the money and hold logic, so they are candidates for human-led execution in artifact 5:

| Unit | U | Driver |
|---|---|---|
| U-005 Jobs outbox, drain route, and the pulse | 2 | Transactional outbox, SKIP LOCKED drain, backoff, dead letters, idempotent route: concurrency correctness. Pattern is known; Hobby cron limits and GitHub schedule jitter add doubt. |
| U-014a Holds core and reserveSpaces | 2 | Concurrency core: lock order, open-hold predicate, capacity guards, real-database race test in CI. Hard to test well; residual risk depends on U-013 outcome. |
| U-016 Ledger and its views | 1 | Double-entry money, posting helpers per entry type, reconciliation views and balance tests. An insert-only role and trigger on Neon through Drizzle migrations is less trodden ground. |
| U-031 Browse with URL filters | 2 | Broad surface: parse/toQuery round-trip, date picker, cursor pagination, skeletons, noindex. searchParams forces dynamic rendering under Cache Components, so the Suspense layout needs settling. |
| U-041 Booking bar, sheet, and panel | 2 | Client draft state, party and 21+ rules, book or gift, a reserve Server Action with several unavailable outcomes and a paused state across three responsive surfaces; action error and revalidation… |
| U-046 Stripe Connect adapter | 3 | Separate charges and transfers, Connect onboarding, Radar, balance-transaction fee timing, webhook ordering; never run here. Spike: does a test-mode SCT flow match the port's fee and transfer assumptions? |
| U-047a startPayment action | 2 | Lock order, idempotent attempt reuse, five outcomes, rate-limited tries, and a two-transaction provider write; Neon serverless transaction and lock support needs confirming. |
| U-047b Checkout page | 2 | Dense form: dynamic attendee and guardian fields from age rules, waiver, hold timer, summary, provider island, maintenance state. Accessible validation across many fields. Iframe-like island isolation is an unknown. |
| U-048 Webhook intake and the event table | 2 | Dedupe plus per-order serial processing on serverless; advisory locks need the WebSocket Neon driver rather than HTTP, and the full event table is a lot of branches. |
| U-049 confirmOrder for bookings | 2 | Money state machine with locks, amount checks, ledger postings, fallbacks and typed stubs for three later units; the stub contracts may move. |
| U-109 Refund path in confirmOrder | 2 | Late-success and duplicate-payment refunds with ledger rows and idempotency; interacts with U-056 refund state machine and alerts. Easy to post twice. |
| U-052 Payment race and idempotency tests | 2 | Spike: can we force deterministic interleavings (two tabs, out-of-order events) against real Postgres in CI without flaky tests? Agents often stall on this. |
| U-055 Manage booking and cancelBooking | 2 | expectedRefundMinor optimistic check, refund split by tier, space return, gift reinstate hook; money plus inventory in one transaction, depending on U-056 and U-066b contracts. |
| U-056 Refund processing | 2 | Refund and transfer-reversal state machine with releasing, paid and failed interplay and retries; ordering edge cases are easy to get wrong. |
| U-059 Session cancellation fan-out | 2 | Lock-ordered fan-out across holds, live attempts, refunds and commission returns; races with in-flight payments and releasing transfers. U-056 refund contract still moving. |
| U-062a purchaseGift and the gift-purchase confirm | 2 | Money and idempotency: confirm-once under duplicate or late success, liability posted once, real-database tests. Shared confirmOrder has many branches landing concurrently, so its contract shifts. |
| U-064a redeemGift and the redemption confirm | 2 | Concurrency: double redemption of one token, refund racing a redemption hold, zero-due postings. Lock order is specified, but reliable concurrent real-database tests in CI take iteration. |
| U-065a Gift exchange: confirm branch | 2 | Least-settled money path: repricing against snapshot, split funding gift then top-up, unused value refund, live-attempt reuse. Needs a ledger worksheet and design pass, not a code spike; size could double. |
| U-066b Gift reinstatement | 2 | Per-leg ledger reversal so liability returns exactly to pre-redemption balance, invoked from two cancel paths. Reinstatement is marked proposed in the design doc. |
| U-074b Experience editor | 2 | Large form surface: every field, price options, tiers, waiver. Photo upload bites on Vercel: Server Action body limits force direct-to-storage upload through ingest. |
| U-074c Availability setup | 2 | Rolling 12-week generator via Clock port, skipping edited or cancelled sessions, DST-correct, plus one-off dated sessions with duplicate check. Idempotent regeneration is fiddly; 20-minute acceptance adds UX tuning. |
| U-077 Bookings, cancellations, and refunds | 2 | Refunds behind step-up, a refund-failed and transfer.failed queue, and audited resends restricted to the booking's email. Money retries and failure queues depend on U-056 and U-079a. |
| U-108 Ops session management | 2 | updateAllocation floor check plus end-experience orchestration: cancelSession per future session and gift exchange or refund offers. Must run through jobs to fit Vercel Hobby function limits. |
| U-079a Weekly release and transfer events | 2 | Money movement with locks, idempotent retries, never-overwrite paid, and dispute netting or transfer reversal. Rules are written, but negative-payable edge cases and the fake adapter's fidelity to Connect are still… |
| U-079b Reconciliation and close-out | 2 | Reconciliation, dispute ledger postings, and fake-adapter dispute events touch money and event ordering. The dispute link is optional until U-081, so the contract between them is still moving. |
| U-096 Load test | 3 | Four scenarios including hold hoarding and mass cancellation hitting locks, outbox, and refunds. Self-hosted Next 16 on a Neon branch may not represent Vercel; findings drive unbounded fix work. |
| U-114 Synthetic booking isolation | 2 | A synthetic flag cutting across catalog, sitemaps, search, transfers, and emails, plus cancel-and-release after each run. Seven dependencies; a missed exclusion leaks into real money or the catalog. |

## Things the panel surfaced

- **Rich-text editor for the editorial admin (U-076a).** Estimators scored it uncertain because no editor is chosen. The moderator proposes Tiptap: it stores the constrained format as JSON and its static renderer works in Server Components without shipping the editor. A small library choice for Dave, not a spike.
- **Spaces-left freshness (U-040)** needs no spike: correctness never depends on the cache, because `reserveSpaces` always recomputes under the lock (design doc 4.2.2).
- **Staff enrolment (U-112)** needs no spike: a single-use enrolment link creates a short-lived session limited to registering a passkey.
- **Passkeys and step-up (U-004b)** drew one spike vote (can Better Auth do per-role sign-in methods and fresh-assertion step-up, testable with Playwright's virtual authenticator). Scored 2 and 2; worth a note in its ticket.

## Appendix: every unit

| Unit | C | U | Spike | Panel spread (C, U) | Driver |
|---|---|---|---|---|---|
| U-001 Repository setup and CI gates | 1 | 1 |  | 0, 0 | Standard Next.js repo scaffold and GitHub Actions gates; done many times. Only wrinkle is Knip and MSW config, both routine. |
| U-002 Walking skeleton | 1 | 1 |  | 0, 1 | Placeholder routes are trivial, but this is the first contact with Cache Components route groups, error boundaries, and Vercel preview deploys on a young release. |
| U-003 Database wiring and migrations | 2 | 2 |  | 0, 0 | Three Neon connection modes plus per-preview branch automation with expiry and a drift check; Neon-Vercel branching wiring and pooled-vs-direct migration behavior need settling. |
| U-004a Sign-in links, roles, and sessions | 2 | 2 |  | 0, 0 | Better Auth magic links are known, but idle timeout on top of 8-hour sessions and reading session cookies without breaking Cache Components static shells need care. |
| U-004b Passkeys and step-up | 2 | 2 |  | 0, 1 | Spike question: can Better Auth's passkey plugin give per-role sign-in methods and a fresh-assertion step-up, testable with Playwright's virtual authenticator? Auth units sprawl when the library… |
| U-116 Caller and role contract | 1 | 1 |  | (PM) | One file with the `Role` enum, the `Caller` type, `getCaller()`, `requireRole()`, and a fixed test caller; no tables. Split from U-004a at the artifact 4 graph review so the data layer can check roles before Better Auth exists. Scored by the PM, not the panel. |
| U-117 Rich-text format and renderer | 1 | 1 |  | (PM) | One focused module: the fixed node and mark list, the sanitizer, and Tiptap's static renderer. Moved out of U-018 at the graph review, so that keystone keeps its scored size. Scored by the PM, not the panel. |
| U-005 Jobs outbox, drain route, and the pulse | 3 | 2 |  | 1, 1 | Transactional outbox, SKIP LOCKED drain, backoff, dead letters, idempotent route: concurrency correctness. Pattern is known; Hobby cron limits and GitHub schedule jitter add doubt. |
| U-006 Email port and dev mailbox | 2 | 1 |  | 0, 0 | Port with three adapters, React Email layout, message log, suppression, and webhook is breadth not novelty; dev mailbox is a simple page over the log. |
| U-007 Logging and error tracking | 2 | 2 |  | 0, 0 | Sentry on Next 16 instrumentation with no client script on checkout routes is awkward since client init is global; request IDs across Server Components and actions… |
| U-008a CSP and security headers | 2 | 3 | yes | 0, 1 (moderated) | Three of four estimators want a spike, and their reason holds up. Next documents that a nonce needs per-request rendering. A nonce cannot reach a prerendered… |
| U-008b Rate limits and bot checks | 2 | 2 |  | 0, 0 | Postgres rate-limit table is simple; BotID on Vercel Hobby (basic vs deep analysis) and the shared edge rule for beacons are less proven. |
| U-009 Cache conventions and tag map | 2 | 3 | yes | 0, 0 | Cache Components is young: cacheLife, cacheTag, updateTag vs revalidateTag semantics and degraded-mode fallbacks on Vercel are unproven here. Spike: tag invalidation and runtime caching behave as… |
| U-010 Storage port and photo ingest | 2 | 1 |  | 0, 1 | Sharp re-encode, EXIF strip, blur placeholders are known; Vercel Hobby body-size and function limits on uploads may force direct-to-storage upload. |
| U-011 Catalog schema and read layer | 2 | 1 |  | 0, 0 | Wide schema with many fields and Zod contracts plus role-checked read functions; lots of surface but approach fully specified in the design doc. |
| U-012 Sessions, templates, and allocations | 2 | 2 |  | 0, 0 | Recurrence in host time zone with idempotent generation and DST correctness, plus allocation-sourced sessions; time-zone edge cases tend to grow. |
| U-013 Concurrency spike on Neon | 2 | 3 | yes | 1, 0 | It is the spike: row-lock behavior through Neon pooler vs HTTP driver under parallel reserves is unknown and determines the driver for every money path. |
| U-111 Pricing and cancellation windows | 2 | 1 |  | 0, 0 | Pure functions for pricing lines, tax, rounding, and cancellation windows in host time zone; money and TZ edge cases but trivially unit-testable. |
| U-014a Holds core and reserveSpaces | 3 | 2 |  | 0, 0 | Concurrency core: lock order, open-hold predicate, capacity guards, real-database race test in CI. Hard to test well; residual risk depends on U-013 outcome. |
| U-014b Hold rules and upkeep | 2 | 2 |  | 1, 0 | Supersede, the device limit, deadline-based blocks, cleanup and a runtime-cached count all interact. How a 'device' is identified is unsettled, and invalidating the cache per session-tag… |
| U-015 Orders, attempts, events, refunds, transfers schema | 2 | 1 |  | 0, 0 | Tables and Zod contracts copied from design doc 4.2.3 with partial unique indexes and row checks; specified, mostly transcription plus constraint tests. |
| U-016 Ledger and its views | 3 | 1 |  | 0, 1 | Double-entry money, posting helpers per entry type, reconciliation views and balance tests. An insert-only role and trigger on Neon through Drizzle migrations is less trodden ground. |
| U-017 Gift tables and state machine | 2 | 1 |  | 0, 0 | Small state machine with token hashing and validity from settings; clear transitions, straightforward tests. |
| U-018 Editorial and policy schema | 2 | 1 |  | 0, 0 | Many editorial and settings tables plus versioned legal documents; publish-invalidates-tags reuses U-009. Breadth over intricacy. |
| U-019 Guests, consents, and privacy | 2 | 2 |  | 0, 0 | Anonymize that preserves payment, tax, and dispute records across tables is fiddly; retention periods pending counsel (Q-16) may change scope. |
| U-020 Audit log | 1 | 1 |  | 0, 1 | An insert-only table with a trigger is small. The nightly export to 'locked storage' (object lock on R2) and the restricted role on Neon are details… |
| U-021a Seed script and scale fixture | 2 | 2 |  | 0, 1 | Coverage matrix for every P3 state reaches into orders, gifts, and holds whose schemas land later; seed will churn as dependents settle. |
| U-021b Curated content and photo pool | 2 | 2 |  | 0, 0 | Mostly content, not code: 60 experiences, 20 guide entries, licensed photos with alt text, tone checklist. Human curation time is the unknown. |
| U-022 Authorization matrix test | 2 | 1 |  | 0, 1 | A matrix harness on a real database branch. Rows depend on actions built much later, so it is an early skeleton that every later unit extends,… |
| U-023 Token export and CSS custom properties | 2 | 2 |  | 0, 0 | Figma variables export path, Style Dictionary mode handling for light, dark, and breakpoint type, and a contract name check; tooling glue tends to need iteration. |
| U-024 Primitives: controls and feedback | 2 | 2 |  | 0, 1 | Eight primitives are routine; Storybook support for Next 16.4 and React 19.3 with the a11y addon in CI may lag the young stack. |
| U-025 Primitives: content and navigation | 2 | 1 |  | 0, 0 | Content and navigation components with mobile and desktop variants; HoldTimer has a little timing logic. Well-trodden work once U-024 sets conventions. |
| U-026 React Aria wrappers | 2 | 2 |  | 0, 1 | React Aria DatePicker and Modal are solid, but a mobile bottom-sheet drawer is not a stock component; iOS Safari scroll lock and keyboard quirks need tuning. |
| U-027 Order summary, booking bar, booking panel | 2 | 1 |  | 0, 0 | Composite components with several booking-bar and summary states; presentational, specified by Figma, moderate story coverage. |
| U-028 Code Connect spike | 1 | 3 | yes | 0, 0 | Untried Code Connect CLI workflow and a published Figma library prerequisite; the spike exists to size U-029. |
| U-029 Code Connect mapping | 1 | 2 |  | 0, 1 | Mapping is mechanical, but Code Connect needs a published library and the right Figma plan tier, both unconfirmed. Prop-to-variant drift with the CSS Modules components is… |
| U-030 Home page and module renderer | 2 | 2 |  | 0, 0 | Config-driven modules plus tag-based caching and a settings tag; Cache Components tag invalidation is young and its boundaries need care. |
| U-031 Browse with URL filters | 3 | 2 |  | 1, 0 | Broad surface: parse/toQuery round-trip, date picker, cursor pagination, skeletons, noindex. searchParams forces dynamic rendering under Cache Components, so the Suspense layout needs settling. |
| U-032 Zero results with ways forward | 1 | 1 |  | 0, 0 | Pure function returning suggestions with counts, plus one state view. Easy to unit test. |
| U-033 Filter drawer and extra filters | 2 | 1 |  | 0, 0 | Responsive drawer and panel with React Aria dialog, five filter types added to an existing query. Familiar work. |
| U-034 Keyword search | 1 | 2 |  | 0, 1 | Small change, but Drizzle has no first-class tsvector, so it needs raw SQL, a generated column, and a GIN index. Ranking that combines with the cursor… |
| U-035 Category and neighborhood pages | 1 | 2 |  | 0, 1 | Reuses the browse query; prerendering with generateStaticParams under Cache Components while sharing a dynamic template is the small unknown. |
| U-036 Ramble Picks and gift guide pages | 1 | 1 |  | 0, 1 | Thin variant on the browse template; the sponsor slot rules (Q-13) are still an open product question. |
| U-037 Guide-only entries | 1 | 1 |  | 0, 0 | One static content page with sponsored links and a cross-sell module. |
| U-038 Help center, legal, accessibility, contact | 2 | 1 |  | 0, 0 | Wide but routine: article search, versioned legal pages, contact form with honeypot, timing check and rate limit, plus seed content. |
| U-039 Experience page content | 2 | 2 |  | 0, 1 | Many content sections on both breakpoints; getting a cached static shell next to dynamic holes right in young Cache Components is the risk. |
| U-040 Upcoming dates and spaces left | 2 | 2 |  | 0, 1 (moderated) | The fullstack spike asks whether updateTag invalidates fast enough. The design does not depend on that: design doc 4.2 accepts a 5-10 s runtime-cache window for… |
| U-041 Booking bar, sheet, and panel | 3 | 2 |  | 0, 0 | Client draft state, party and 21+ rules, book or gift, a reserve Server Action with several unavailable outcomes and a paused state across three responsive surfaces;… |
| U-042 Structured data and share images | 1 | 2 |  | 0, 1 | JSON-LD is routine. Branded OG images through next/og need fonts and token styling inside Satori limits, plus caching under Cache Components. Small unknowns. |
| U-043 Private session request | 1 | 1 |  | 0, 0 | One form, one action writing a row and sending two notifications. |
| U-044 Review display | 1 | 1 |  | 0, 0 | Threshold-gated display and an aggregate rating on cards. |
| U-045a Payments port and fake adapter | 2 | 2 |  | 1, 0 | Port must model Stripe semantics faithfully (fees on retrieve, kept on refund, balance netting, transfers and reversals); a sloppy fake hides real-job bugs. Contract shape still… |
| U-045b Fake payment UI and event simulator | 2 | 1 |  | 0, 0 | Simulated card form, decline, 3DS and wallet branches, and an event scheduler for late and repeated delivery; fully under our control. |
| U-046 Stripe Connect adapter | 3 | 3 |  | 0, 1 | Separate charges and transfers, Connect onboarding, Radar, balance-transaction fee timing, webhook ordering; never run here. Spike: does a test-mode SCT flow match the port's fee and… |
| U-047a startPayment action | 3 | 2 |  | 0, 0 | Lock order, idempotent attempt reuse, five outcomes, rate-limited tries, and a two-transaction provider write; Neon serverless transaction and lock support needs confirming. |
| U-047b Checkout page | 3 | 2 |  | 1, 1 | Dense form: dynamic attendee and guardian fields from age rules, waiver, hold timer, summary, provider island, maintenance state. Accessible validation across many fields. Iframe-like island isolation… |
| U-048 Webhook intake and the event table | 3 | 2 |  | 0, 0 | Dedupe plus per-order serial processing on serverless; advisory locks need the WebSocket Neon driver rather than HTTP, and the full event table is a lot of… |
| U-049 confirmOrder for bookings | 3 | 2 |  | 0, 0 | Money state machine with locks, amount checks, ledger postings, fallbacks and typed stubs for three later units; the stub contracts may move. |
| U-109 Refund path in confirmOrder | 3 | 2 |  | 1, 0 | Late-success and duplicate-payment refunds with ledger rows and idempotency; interacts with U-056 refund state machine and alerts. Easy to post twice. |
| U-106 Paying-hold lapse job | 2 | 2 |  | 0, 0 | A lock-and-void job that must race safely with late success; Vercel Hobby cron is daily, so the pulse cadence from U-005 matters. |
| U-050 Confirmation page and order status | 2 | 1 |  | 0, 0 | Token-gated page, polling, calendar file and noindex rules. Familiar patterns. |
| U-051 Checkout failure states | 2 | 1 |  | 0, 1 | Five failure states spread across four upstream units; mostly UI, but it depends on those outcome contracts holding steady. |
| U-052 Payment race and idempotency tests | 3 | 2 |  | 0, 1 | Spike: can we force deterministic interleavings (two tabs, out-of-order events) against real Postgres in CI without flaky tests? Agents often stall on this. |
| U-053 Checkout script inventory and PCI | 1 | 2 |  | 0, 1 | One Playwright network assertion, but Next chunks, Vercel and Sentry injections make the allowlist fiddly to pin down. |
| U-054 Booking emails | 2 | 1 |  | 0, 0 | Five React Email templates, an .ics attachment, and a timing check; routine work. |
| U-055 Manage booking and cancelBooking | 3 | 2 |  | 0, 1 | expectedRefundMinor optimistic check, refund split by tier, space return, gift reinstate hook; money plus inventory in one transaction, depending on U-056 and U-066b contracts. |
| U-056 Refund processing | 3 | 2 |  | 0, 0 | Refund and transfer-reversal state machine with releasing, paid and failed interplay and retries; ordering edge cases are easy to get wrong. |
| U-057 Move a booking | 2 | 2 |  | 0, 0 | Hold swap on the new session plus release of the old; price differences and how terms apply on a move are not yet defined. |
| U-058 Reminder emails | 1 | 1 |  | 1, 0 | Outbox job scheduling with edge cases: booking inside 24h, retime moving the reminder, cancel suppressing it, outdoor-only note. Well-trodden pattern on the existing jobs table. |
| U-059 Session cancellation fan-out | 3 | 2 |  | 0, 0 | Lock-ordered fan-out across holds, live attempts, refunds and commission returns; races with in-flight payments and releasing transfers. U-056 refund contract still moving. |
| U-060 Review invites, collection, and storage | 2 | 1 |  | 0, 0 | Invite job, tokenized submission, one-per-order constraint, gift recipient as verified booker. Standard CRUD with a few eligibility rules. |
| U-061 Review moderation basics | 1 | 1 |  | 0, 0 | Report flag and hide toggle in the ops shell, plus cache invalidation of the review list. Small and familiar. |
| U-107 Guest account: my bookings | 2 | 2 |  | 0, 0 | Guest sign-in via Better Auth email link joined to accountless orders by verified email; authorization matrix row. Dynamic personalized header under Cache Components needs care to… |
| U-062a purchaseGift and the gift-purchase confirm | 3 | 2 |  | 0, 0 | Money and idempotency: confirm-once under duplicate or late success, liability posted once, real-database tests. Shared confirmOrder has many branches landing concurrently, so its contract shifts. |
| U-062b Gift checkout and gift-scheduled pages | 2 | 2 |  | 0, 1 | Two pages plus decline, connection-lost polling, and too-many-tries states, all on the gifts-off toggle. It reuses a card island and retry UI that are not built… |
| U-063 Gift delivery | 2 | 2 |  | 0, 1 | Delivery at send_at with sender and recipient caps. Hobby cron granularity may not deliver on time, so the job runner's precision is the open question. |
| U-064a redeemGift and the redemption confirm | 3 | 2 |  | 0, 0 | Concurrency: double redemption of one token, refund racing a redemption hold, zero-due postings. Lock order is specified, but reliable concurrent real-database tests in CI take iteration. |
| U-064b Gift redemption page | 2 | 1 |  | 0, 0 | One page with many invalid-gift states, noindex and no-unfurl headers, reused S6/S7 hold states. Surface over intricacy. |
| U-065a Gift exchange: confirm branch | 3 | 2 |  | 0, 1 | Least-settled money path: repricing against snapshot, split funding gift then top-up, unused value refund, live-attempt reuse. Needs a ledger worksheet and design pass, not a code… |
| U-065b Gift exchange: page and top-up | 2 | 2 |  | 0, 0 | Experience picker for same party plus requires_payment on the card island; depends on U-065a's still-forming top-up contract and U-047b's island holding up to a second use. |
| U-066a Gift expiry and buyer refunds | 2 | 1 |  | 0, 1 | Daily expiry job that has to skip gifts with an open hold, plus the buyer refund. The race against redemption holds and the refund_pending states drive… |
| U-066b Gift reinstatement | 3 | 2 |  | 0, 0 | Per-leg ledger reversal so liability returns exactly to pre-redemption balance, invoked from two cancel paths. Reinstatement is marked proposed in the design doc. |
| U-067 Host shell and access | 1 | 1 |  | 0, 0 | Layout from the component library plus host scoping over U-025's authorization layer. Familiar App Router route-group work. |
| U-068 Publish a week and edit sessions | 2 | 2 |  | 0, 1 | Week view, publishing from templates, and edit rules that depend on booked state (PRD-41). It is unclear which edits can touch sold capacity, and the usability… |
| U-069 Guest lists | 1 | 1 |  | 0, 0 | Read-only per-session list with print stylesheet and share. One layer, simple tests. |
| U-070 Host cancels or retimes a booked session | 2 | 2 |  | 0, 0 | Guest-impact preview then wiring to cancelSession; retime of a booked session semantics (cancel-and-offer versus move) need settling against PRD-41. |
| U-071 Statements and payouts | 2 | 2 |  | 0, 1 | Owed, released, and upcoming figures derived from ledger postings, including dispute deductions. Reconciliation correctness depends on U-079a's ledger shape. |
| U-072 Host staff access | 2 | 2 |  | 0, 1 | Staff roles per host, with authorization across every host route. The fit of Better Auth's organization and roles model is unverified. |
| U-073 Ops shell, passkeys, and audit wiring | 2 | 2 |  | 0, 0 | Passkey sign-in and step-up UI on Better Auth; step-up freshness is not a stock Better Auth feature. Audit wiring is cross-cutting; WebAuthn in Playwright needs virtual… |
| U-112 Ops staff and roles admin | 2 | 2 |  | 0, 1 (moderated) | The other side wants a spike because Better Auth's passkey plugin needs an existing session to register a credential. The known answer is to compose two… |
| U-074a Host setup | 2 | 1 |  | 0, 0 | Host record, sign-in-link invite, versioned legal acceptance, simulated payout account. Several steps, all familiar. |
| U-074b Experience editor | 3 | 2 |  | 1, 1 | Large form surface: every field, price options, tiers, waiver. Photo upload bites on Vercel: Server Action body limits force direct-to-storage upload through ingest. |
| U-074c Availability setup | 3 | 2 |  | 0, 0 | Rolling 12-week generator via Clock port, skipping edited or cancelled sessions, DST-correct, plus one-off dated sessions with duplicate check. Idempotent regeneration is fiddly; 20-minute acceptance adds… |
| U-075 Experience review and approval | 2 | 2 |  | 0, 0 | Queue with gating rules (content rights, alt text, tax) and guide-only promotion; tag invalidation across experience and guide pages under Cache Components is where staleness bugs… |
| U-076a Editorial editing and publish | 2 | 2 |  | 1, 1 (moderated) | The 3s come from the editor not being chosen yet. That is a decision for the design doc, not an unknown that needs an experiment. Pin… |
| U-076b Home and collections admin | 2 | 1 |  | 0, 0 | Ordered module and collection admin with sponsor slot, reusing U-076a editor and publish path. |
| U-076c Pages and documents admin | 2 | 1 |  | 0, 0 | Several content types on the U-076a base; versioned legal documents need immutability once accepted. Breadth, not intricacy. |
| U-077 Bookings, cancellations, and refunds | 3 | 2 |  | 1, 1 | Refunds behind step-up, a refund-failed and transfer.failed queue, and audited resends restricted to the booking's email. Money retries and failure queues depend on U-056 and U-079a. |
| U-113 Ops gift support | 2 | 2 |  | 0, 1 | Search, resend and re-address within the caps, a buyer refund, and a manual close-out of refund_pending. The close-out must keep the ledger consistent. |
| U-108 Ops session management | 3 | 2 |  | 0, 0 | updateAllocation floor check plus end-experience orchestration: cancelSession per future session and gift exchange or refund offers. Must run through jobs to fit Vercel Hobby function limits. |
| U-078 Settings and ops switches | 2 | 2 |  | 0, 1 | Settings forms are simple, but banner and pause switches must reach prerendered, cached pages immediately; cache invalidation of settings reads under Cache Components drives the score. |
| U-079a Weekly release and transfer events | 3 | 2 |  | 0, 0 | Money movement with locks, idempotent retries, never-overwrite paid, and dispute netting or transfer reversal. Rules are written, but negative-payable edge cases and the fake adapter's fidelity… |
| U-079b Reconciliation and close-out | 3 | 2 |  | 0, 0 | Reconciliation, dispute ledger postings, and fake-adapter dispute events touch money and event ordering. The dispute link is optional until U-081, so the contract between them is… |
| U-080 Finance export | 2 | 1 |  | 0, 1 | Ledger view per booking is routine, but reconciling rows to provider payouts and the unknown-tax-treatment flag need definitions; fee attribution per booking must match ledger exactly. |
| U-110 Money-held view | 1 | 1 |  | 0, 0 | One read-only ops page over an existing ledger view. |
| U-081 Dispute record | 2 | 1 |  | 0, 0 | CRUD for dispute records linked to postings, plus a simulator UI. Several states but a familiar shape. |
| U-082 Spreadsheet import | 2 | 2 |  | 0, 0 | Parsing, row validation, and a dry run that matches the real write. File size and Server Action body limits on Vercel Hobby, plus messy host spreadsheets,… |
| U-083a Support queue | 1 | 1 |  | 0, 0 | A simple ops list with tags and status over existing data. |
| U-083b Private requests queue | 1 | 1 |  | 0, 0 | A simple ops list with status, the same shape as U-083a. |
| U-084 Trust and safety | 2 | 2 |  | 0, 0 | Private document storage with signed access, and suspension that must reach cached catalog pages. Cache invalidation under Cache Components is the risk. |
| U-085 Privacy requests | 2 | 2 |  | 0, 0 | Anonymization across many tables plus vendors (Sentry, email, auth). Each vendor's deletion API and the ledger retention rules are unknowns. |
| U-086 Events table and beacons | 2 | 2 |  | 0, 0 | Beacons from cached pages, bot and synthetic filtering, dedupe, and inserts inside booking transactions. Getting session IDs without making Cache Components pages dynamic is the risk. |
| U-087 Attribution capture | 2 | 2 |  | 0, 0 | Reading cookies and query params on cached pages forces dynamic rendering, so capture must sit in proxy or client code. The 30-day last-non-direct rule and consent… |
| U-088 Investor report and funnel | 2 | 1 |  | 0, 1 | Many metric views, snapshots, a report page, and a read-only role on Neon. Metric definitions (GMV, take rate, repeat) invite rework when numbers disagree with the… |
| U-089 Web-vitals field data | 1 | 1 |  | 0, 0 | The web-vitals attribution build to an endpoint, plus a p75 query. Done many times. |
| U-090 Live dashboard and cohorts | 2 | 1 |  | 0, 0 | Charts over existing views, plus cohort retention SQL. Moderate but well understood. |
| U-091 Address scheme and slug history | 2 | 2 |  | 0, 0 | Slug-history and guide-to-experience 301s, plus a route-table CI check. Where to redirect (proxy versus page) under Cache Components, and avoiding redirect loops, need settling. |
| U-092 Sitemaps, robots, and crawler checks | 2 | 1 |  | 0, 0 | Split sitemaps, per-environment robots, canonicals, and a crawler test. These are known App Router metadata APIs. |
| U-093 Redirect map and guide import | 2 | 3 | yes | 0, 1 (moderated) | This depends on an outside question no one has answered yet. Hosted site builders differ a lot in what they export: some give a blog-only XML,… |
| U-094a Post-launch redirect fixes | 1 | 2 |  | 0, 1 | Small weekly fixes into the redirect map; volume depends on what crawl errors appear after launch. |
| U-094b Decommission the old site | 1 | 2 |  | 0, 1 | Mechanically trivial; timing hinges on organic traffic meeting G7 and vendor cancellation terms. |
| U-095 Lighthouse budgets and lab runs | 2 | 2 |  | 1, 0 | Lighthouse CI against previews with stable budgets is often flaky; mid-range Android lab runs need device access and baseline tuning. |
| U-096 Load test | 3 | 3 |  | 1, 1 | Four scenarios including hold hoarding and mass cancellation hitting locks, outbox, and refunds. Self-hosted Next 16 on a Neon branch may not represent Vercel; findings drive… |
| U-097 Uptime, heartbeats, SLO, synthetic booking | 2 | 2 |  | 0, 1 | Better Stack setup is routine; synthetic booking through the pulse depends on U-114 isolation and timing checks on email delivery add moving parts. |
| U-114 Synthetic booking isolation | 3 | 2 |  | 0, 0 | A synthetic flag cutting across catalog, sitemaps, search, transfers, and emails, plus cancel-and-release after each run. Seven dependencies; a missed exclusion leaks into real money or… |
| U-098 Backups and restore rehearsal | 2 | 2 |  | 1, 1 | Hourly pg_dump to R2 needs a runner outside Vercel Hobby (Actions cron); restore test against a Neon branch. Dump size and timing unknown. |
| U-099 Runbooks and rehearsal | 2 | 1 |  | 0, 1 | Ten runbooks are easy for agents; rehearsals need Dave and routinely surface fixes in other units, which is where size moves. |
| U-115 Launch cutover runbook and rehearsal | 2 | 2 |  | 0, 0 | Cutover order, freeze, and back-out to the old site, rehearsed on staging. The old site builder's behavior and DNS timing are outside our control. |
| U-100 Accessibility pass | 2 | 2 |  | 0, 1 | Nightly axe matrix is mechanical; manual screen-reader pass of checkout surfaces fixes of unknown size across many prior units. |
| U-101 Device matrix and wallets | 2 | 3 | yes | 0, 0 | Spike: do Better Auth passkeys and checkout work in Instagram and mail in-app webviews? Also unclear what an Apple Pay check proves against a fake gateway. |
| U-102 Scanning and secrets | 1 | 1 |  | 0, 0 | Standard scanners and a runbook. Configuration only. |
| U-103 Staged releases and freeze rule | 2 | 2 |  | 0, 0 | Staged promotion on Vercel Hobby, expand-then-contract migrations across staging and production, and warming cached pages. Hobby's promotion features and Cache Components warm-up behavior are untested. |
| U-104 Launch readiness review | 2 | 2 |  | 0, 1 | Tracing every Must to a passing check across ~37 dependencies is broad; gaps found here spill back into other units. |
| U-105 Booking-path smoke and nightly suite | 2 | 2 |  | 0, 0 | An end-to-end required PR check against a production build with seeded data and a fake gateway. Flakiness and per-run database isolation are the cost drivers. |
