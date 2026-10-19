# Industry-gap review

Prepared 2026-10-18 by ramble-pm from five area notes in [industry/](industry/), a free-tier fact-check, and a completeness critic. Question: what does an industry-grade marketplace of this kind need that the ten accepted ADRs don't cover, and what free version can the demo carry?

Nothing here is built before the plan freeze. Tier A items become P4 units and are built in P5; Tier B is planned and simulated; Tier C is logged.

## Summary

- **113 capabilities checked** across caching and performance, jobs and email, security, observability and delivery, and product operations: 4 already covered, 52 partly covered, 57 gaps. The critic added 17 more.
- **The biggest single gap is email.** Nine PRD requirements send email (confirmations, reminders, cancellations, gifts, host notices) and no ADR names a provider, templates, a message log, or a way to keep previews and seeds from emailing real people.
- **Durable background work is the second.** Reminders, gift delivery and expiry, weekly host transfers, and webhook retries need an outbox and a scheduler tick; Vercel Hobby runs cron once a day.
- **Most of the rest is cheap to design in and costly to retrofit:** cache-safe responses, a tag map for invalidation, rate limits, a protected audit log, migrations in CI, staged releases with rollback, ops kill switches, page-address rules, and a clean events table.
- **Nearly all of Tier A runs free in the demo,** mostly as code on Postgres. The paid pieces are the real job's hosting tier, email volume, paging, a helpdesk, and repo security features.
- **Free-tier fact-check:** 249 limits and prices checked against vendor pages; 236 confirmed, 10 corrected (all nuance, none changes a pick), 3 unverifiable.
- **Two accepted decisions need revisiting** (decisions D1 and D2 below): Vercel's fair-use page lists "requesting or processing payment" as commercial use, which may rule out Hobby for a site with a checkout; and a private repo loses free code scanning, secret push protection, and branch protection.

## Tier A: launch-critical, free in the demo

Grouped by the ADR that would hold each. "Demo" says how the free version works.

### Caching and performance (amend ADR 0001)

| Capability | Plan | Demo |
|---|---|---|
| Cache-safe responses | Explicit `cacheLife` on every cached function; no `Set-Cookie` or `Vary: Cookie` on guest routes; a CI test asserts it | Same; Hobby gives 1M CDN requests and 100 GB transfer a month |
| Hot reads under spikes | "Spaces left" through Vercel Runtime Cache (5 to 10 s revalidate, tag per session); Postgres stays authoritative at reserve; no Redis | Same code; falls through to Postgres on a miss |
| Catalog caching | Two low-cardinality cached indexes filtered in memory; category, neighborhood, and Picks pages prerendered | Same; check each entry stays under the 2 MB item cap |
| Invalidation | One tag module and a `tagsForChange()` function; `updateTag` from admin actions, `revalidateTag` from webhooks | Free; 50 revalidations a second on Hobby |
| Deploy behavior | Prerender published pages, warm after deploy, no production promotion around newsletter sends | Free |
| Graceful degradation | Stale content on failed revalidation; availability falls back to a "Check availability" button; checkout maintenance state | Free |
| Images | Photo ingest validates, re-encodes, strips location data, stores a blur placeholder; `next/image` WebP at one quality, trimmed sizes, long cache | Hobby: 5,000 transformations a month, so the 400-experience fixture reuses the curated photo pool |
| Database connections | Pooled host for app traffic, direct host for migrations and dumps; HTTP driver for single reads, a pooled transaction for holds | Same on Neon Free |
| Fonts and prefetch | `next/font/local`, two families at most; prefetch only on the main call to action | Free |

### Background jobs and email (new ADR 0011)

| Capability | Plan | Demo |
|---|---|---|
| Outbox and jobs | A Postgres `jobs` table written in the same transaction as the state change, drained with `SKIP LOCKED`, retries, dead letters | Same code, free |
| Scheduler tick | One secured, idempotent drain route on a schedule; cron is a best-effort tick, not the queue | Depends on D2 |
| Webhook intake | Verify the signature on the raw body, store with a unique event ID, return 2xx, process through jobs | Same; the demo's fake gateway posts the same shape |
| Email provider | Resend behind `lib/email` with `resend`, `postmark` (spare), and `fake` adapters | Fake adapter plus an in-app dev mailbox; real sends only to allowlisted addresses, and only with a domain (D3) |
| Templates | React Email in the repo, HTML and plain text, one shared layout | Free |
| Send safety | `EMAIL_MODE` (sink, allowlist, live) enforced in the wrapper; live only in production | Free |
| Message log | A `messages` table, signed delivery webhooks, a suppression list, an ops view | Fake adapter simulates every status |
| Calendar | `.ics` attachment and add-to-calendar links, stable UID, cancel updates | Free |
| Support routing | Reply-To a monitored support address, never no-reply; help link in every email | Free |
| Gift email controls | Send only after payment; caps per sender and recipient; plain-text message with no links | Free |
| Heartbeats | Every scheduled job reports success or failure; alert when the tick stops | Monitoring pick (D4 package) |

### Security and abuse (new ADR 0012)

| Capability | Plan | Demo |
|---|---|---|
| Rate limits | App limits in a Postgres table (sign-in links, reserve, payment attempts, manage-booking, forms) behind a wrapper; edge rules on Vercel's firewall | Postgres limiter free; Hobby allows one rate-limit rule, so the two beacons share a path prefix |
| Bot defense | Vercel BotID on reserve, sign-in, and forms, behind a wrapper | BotID Basic is free on all plans |
| Seat hoarding and card testing | Layered keys (device cookie, IP, fingerprint); payment only against an active hold; at most 5 attempts a hold; decline-rate alerts | Same on the fake gateway; add the scenarios to the load test |
| Headers and CSP | Nonce-based CSP on dynamic routes (checkout, host, ops), report-only on cached pages; full security header set | Report-only everywhere, free |
| Secrets and accounts | Secret-type variables, a rotation runbook, MFA on every vendor account | Free |
| Scanning | gitleaks for secrets, Dependabot and OSV-Scanner for dependencies, supply-chain settings in the package manager | Free on a private repo; CodeQL and push protection free only if public (D1) |
| Staff sign-in | Passkeys required for ops and admin, email links off for those roles, 8-hour sessions, step-up for refunds and payout changes | Better Auth passkey plugin, free |
| Link hardening | Random tokens hashed at rest; single-use 5-minute sign-in links; uniform replies | Free |
| Machine endpoints | Signature checks on webhooks; a bearer secret on scheduled calls; admin triggers need step-up and an audit row | Free |
| Authorization tests | A role-by-action matrix run in CI against the real database | Free |
| Audit-log protection | A restricted database role (insert and select only), a trigger blocking changes, optional hash chain (watch lock contention during mass cancellations), nightly export to locked storage | Free on Neon; Cloudflare R2 free tier for the export |
| Disclosure and incidents | `security.txt`, a one-page incident runbook, an advisory response time in the retainer | Free |

### Observability, environments, and delivery (new ADR 0013)

| Capability | Plan | Demo |
|---|---|---|
| Logging | One logger wrapper: JSON with request and trace IDs, a redaction list, no emails | Free; Hobby keeps 1 hour of logs, so warnings and errors also go to a free log store (D4 package) |
| Monitoring stack | One tool per job: Sentry for errors, one uptime-heartbeat-status tool, one log store | D4 package |
| Availability SLO | A written definition of "up" for PRD-71, a 43-minute monthly budget, vendor-caused downtime reported separately, a monthly report | SQL over probe history |
| Timing SLIs | Lag for confirmations, reminders, and webhooks measured in Postgres, checked on a schedule | Free |
| Runbooks | About ten one-page runbooks linked from alerts; one rehearsal (rollback, restore, probe failure) before launch | Markdown, free |
| Ops switches | A settings table in the admin: site banner, pause bookings (global or per experience), gifts off; each change audited | Free; same mechanism as gift validity |
| Preview databases | A Neon branch per preview, expiring after 7 days | Neon Free allows 10 branches |
| Staging | A staging environment with the scale fixture | Branch-based on Hobby; custom environment on Pro |
| Seed policy | Curated seed for local and previews, scale fixture on staging, reference data only in production | Demo production carries the curated seed, labeled as a demo |
| Migrations | Committed Drizzle migrations, a drift check per PR, migrate preview, staging, then production; expand then contract | Free |
| Releases | Staged production deployment, smoke test, then a printed promote command (gate 5); rollback runbook | Staged deploys free; Hobby rolls back to the previous deployment only |
| Backups | The hourly `pg_dump` from ADR 0002 runs on a schedule to another provider, with a monthly restore test | A scheduled job to Cloudflare R2's free tier (runner depends on D1 and D2) |

### Product operations and compliance (new ADR 0014)

| Capability | Plan | Demo |
|---|---|---|
| Support | A contact form into a `support_requests` table and an ops queue with reason tags (support emails per 100 bookings is a guardrail) | Free; a helpdesk is Tier B |
| Help center | Help articles as an editorial-admin content type with text search | 12 to 15 seeded articles |
| SEO | Split sitemaps with real last-modified dates, robots and noindex per environment, a CI redirect-map check, a crawler-view test, `rel=sponsored` on affiliate links | Free; the demo stays noindex |
| Page addresses | ID-bearing slugs and a slug-history table that 301s on rename, so PRD-63 holds as the catalog changes | Free |
| Share previews | Branded Open Graph images per experience and Pick; token links never unfurl | Built into Next.js, free |
| Privacy | A script inventory with a CI check, no consent banner while scripts stay first-party (verify with counsel), data-request flow, consent record, vendor register, retention table, children's data rule | Free |
| Accessibility | A required alt-text field on every photo, an accessibility statement, a feedback path with a response time | Free |
| Legal documents | Versioned legal documents with acceptance rows pointing at a version | Placeholder text labeled demo |
| Investor reporting | A reporting schema with a read-only role, synthetic traffic excluded, an ops report page with month snapshots tied out to the ledger | Free |
| Events quality | Bot and internal-traffic filtering and dedupe on the events table, so funnel numbers aren't inflated by crawlers, tests, and staff | Free |
| Receipts and statements | Receipt page with seller-of-record wording for the agent model; printable host statements | Print-styled HTML |
| Trust and safety | Host insurance and licence documents in private storage, incident intake, suspend, a copyright takedown contact | Seeded documents in a private store |
| Device matrix | Real iPhone and Android checks, including the Instagram and mail in-app browsers | Playwright WebKit plus Dave's phones |

## Tier B: real job only

Planned in the ADRs and costed in P4; the demo simulates them.

| Item | Why it's paid or gated | Rough cost |
|---|---|---|
| Vercel Pro features: per-minute cron, Skew Protection, 30-day observability, firewall rules, BotID Deep Analysis | Not on Hobby | $20 a month plus usage; Observability Plus and BotID metered |
| Neon Launch: always-on compute floor, longer history | Free tier scales to zero, 6-hour history | About $19 to $39 a month always-on (estimate) |
| Resend Pro and a sending domain with DMARC | Volume and deliverability | $20 a month |
| Helpdesk (Help Scout) | Shared inbox for 300 emails a week | About $50 a month for two seats |
| Paging (Better Stack responders or PagerDuty) | Someone has to answer an outage | About $25 to $34 a month |
| GitHub security features on a private repo | Push protection, CodeQL, branch protection | $19 to $30 per committer a month, or free if public |
| Synthetic browser checks every 5 minutes (Checkly) | Free cadences exhaust minutes and compute | About $64 a month |
| External pen test before the full newsletter send | Industry norm for a payments site | Not researched |
| Search Console and crawl monitoring on the current site, starting now | Baseline before migration (G7) | Free, but needs the client's property |
| Tax operations: who files New York State and City sales tax, host W-9s and 1099s | A client process, not code; affects onboarding (PRD-39) | Counsel and the CFO |
| Vendor account ownership and handover | The client owns Vercel, Neon, Stripe, GitHub, the registrar | Process |

## Tier C: before scale or later

Tracing with OpenTelemetry; a log drain beyond 30 days; a read replica; an image CDN; a second email provider for failover; newsletter platform sync; SMS (PRD-31); a notification platform; release flags and experiments (the settings table covers ops switches at launch); Global Privacy Control; Event structured data; DAST and header scanning; a security-events table; nightly accessibility monitoring over a template matrix; a host calendar feed; an accounting export and revenue-recognition rules; a weather signal for outdoor sessions; bulk supply import; an AI-crawler policy; a review moderation policy; booking context in the helpdesk.

## Cross-cutting rules (from the critic)

1. **One demo pulse.** One scheduled call every 30 minutes runs all due work: job tick, synthetic probe, timing SLIs, dump trigger. Five areas each budgeted their own cadence against the same free tiers.
2. **One free-tier budget table**, below, checked before adding any scheduled work.
3. **One vendor per job:** one error tracker, one uptime-heartbeat-status tool, one log store, one bot check.
4. **One list of new tables**, added to ADR 0002 once: jobs, messages, rate limits, settings, synthetic runs, support requests, privacy requests, legal documents, report snapshots, slug history, photo metadata.
5. **One PII inventory** covering every new table and vendor, so deletion requests (PRD-73) reach all of them.
6. **One checkout script inventory** (ADR 0003): the payment scripts and Ramble's first-party reporter. Bot checks, error scripts, and flags stay off checkout unless the inventory is amended.
7. **Load tests run against a self-hosted production build** on a Neon branch, because Vercel's policy limits load tests on its platform. Cache-header checks run on Vercel previews.
8. **One deploy freeze rule:** no production promotion from 30 minutes before to 3 hours after a newsletter send.

## Free-tier budget (demo)

| Resource | Free limit | Main consumers |
|---|---|---|
| Neon compute | 100 CU-hours a month; scales to zero after 5 minutes | The pulse, page traffic, CI database tests, preview branches |
| Neon branches | 10 per project | Previews, CI, staging, the load-test branch |
| Vercel CDN | 1M requests, 100 GB transfer a month | One newsletter-sized load run is about 1.3M requests (estimate), so it runs self-hosted |
| Vercel images | 5,000 transformations a month | 60 curated experiences use about 1,200 |
| Vercel Blob | 1 GB, 2,000 advanced operations a month; blocked 30 days if exceeded | Photo pool and trust documents |
| Vercel logs | 1 hour runtime logs, 12 hours observability | Hence an outside log store |
| Speed Insights | 10,000 events per rolling 30 days; pauses when exceeded | Ramble's own web-vitals endpoint carries the real data |
| GitHub Actions | 2,000 minutes a month on a private repo (unlimited if public) | CI, nightly suites, the pulse if it runs here |
| Resend | 3,000 emails a month, 100 a day | Only with a domain (D3) |
| Sentry | 5,000 errors, 1 user, 1 cron monitor | Errors |
| Better Stack | 10 monitors, 10 heartbeats, 1 status page | Uptime, heartbeats, status |

## Conflicts with accepted ADRs

| ADR | Conflict | Proposed resolution |
|---|---|---|
| 0007 | Hobby is "personal, non-commercial", and Vercel's fair use lists "requesting or processing payment" as commercial | D2 |
| 0007 | Body says public repo at plan freeze; status line says private now | D1 |
| 0007 vs 0010 | 0007 says production deploys on merge to `main`; 0010 keeps deploys as Dave's | Staged production deployment with a printed promote command (ADR 0013) |
| 0006 | k6 "against a preview" breaks Vercel's load-test policy | Self-hosted production build on a Neon branch |
| 0006 | Synthetic booking "every few minutes" exhausts free compute | Every 30 minutes in the demo via the pulse; 5 minutes in the real job |
| 0002 | Its exit trigger for a hosted identity provider was MFA for ops; the research keeps Better Auth and adds passkeys | Amend ADR 0002 to passkeys on Better Auth |
| 0003 | Body still describes a Stripe sandbox; the accepted change is the fake gateway | Body note added when ADR 0012 is written |
| 0007 | The consent open item | Tier A privacy row (no banner while first-party only), pending counsel |

## Proposed ADR map

| ADR | Holds |
|---|---|
| New 0011 | Background jobs, scheduling, and transactional email |
| New 0012 | Security and abuse |
| New 0013 | Observability, environments, and delivery |
| New 0014 | Product operations and compliance |
| Amend 0001 | Caching and performance rules |
| Amend 0002 | New tables, connection policy, backup runner, passkeys, photo metadata and alt text, slug history |
| Amend 0005 | Help articles, legal documents, and alt text in the editorial admin |
| Amend 0006 | Load-test location, synthetic cadence, device matrix, crawler and redirect checks, events-quality tests |
| Amend 0007 | Hosting tier, repo visibility, domain, monitoring stack, the pulse |

## Decisions (Dave, 2026-10-18)

- **D1:** public at plan freeze.
- **D2:** stay on Hobby; the demo checkout states no payment is taken.
- **D3:** no domain; the demo stays on `*.vercel.app`.
- **D4:** adopt Tier A as P4 input, but no new ADRs: everything is folded into amendments to ADRs 0001, 0002, 0006, and 0007 (written 2026-10-18). The proposed ADR map above was not used. Monitoring stack as proposed: Sentry, Better Stack free, Axiom free.

## Decisions as asked

- **D1 Repo visibility.** Public at plan freeze (free CodeQL, secret push protection, branch protection, unlimited Actions minutes) or private (gitleaks, a manual merge gate, a 2,000-minute budget).
- **D2 Hosting tier.** Vercel Pro from the walking skeleton ($20 a month; also unlocks per-minute cron for the pulse, Skew Protection, and 30-day observability) or Hobby, accepting the fair-use question for a checkout page.
- **D3 A domain.** Buy one for the demo (needed for real email sends, a stable host for passkeys, and a branded status page) or stay on `*.vercel.app` with the email sink only.
- **D4 The package.** Adopt Tier A as P4 input, write ADRs 0011 to 0014 and the amendments above, and use Sentry, Better Stack free, and Axiom's free plan as the monitoring stack.
