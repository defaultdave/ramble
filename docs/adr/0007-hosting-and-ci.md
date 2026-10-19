# ADR 0007: Hosting, CI, and repository

- **Status:** Accepted 2026-10-18 (Dave), with one change: the GitHub repo is created now, private, instead of at plan freeze. The demo runs on Vercel Hobby with scheduled jobs triggered by hand; the real job is planned on Pro.
- **Date:** 2026-10-18
- **Question:** R7 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0001 (framework), ADR 0002 (data store and its backups)
- **Settles stack decisions:** hosting and deploy target; analytics and monitoring vendors (each behind a wrapper, ARCH-8)

## Context

The client has no engineers (C-04) and about $8k a month for ongoing work (C-01), so hosting should need no operations staff. Traffic is spiky: a weekly newsletter sends up to about 12,500 visitors in a few hours (PRD-70, Q-20 open). The demo build is non-commercial, uses test-mode payments, and needs preview deploys for agent pull requests. Deploys and repo creation are Dave's gate.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-70 | Spike load without degrading PRD-68 thresholds |
| PRD-71 | 99.9% monthly availability of the booking path |
| PRD-75 | Restore within 24 hours, losing no more than 1 hour of records |
| PRD-27, PRD-33 | Reminders 24 hours before (within an hour) and gift emails within 5 minutes of the delivery time need a scheduler that runs every few minutes |
| PRD-64 | Redirects for every current page with organic traffic |
| PRD-68 | Fast on phones; field data after launch |
| PRD-72 | Card data never touches Ramble's servers (unaffected by hosting, since Stripe-hosted fields carry it) |
| C-01, C-04 | Budget and no in-house engineers |

## Options

**A. Vercel, with GitHub Actions for CI gates.** Preview deploy per pull request, production on merge to `main`, functions in the US East region next to the database (ADR 0002).
- Fit: built by the Next.js team, so framework features work first; scales with spikes without capacity planning; no servers for the client to run.
- Cost: Pro is $20 a month plus $20 per extra developer seat ([pricing](https://vercel.com/pricing), checked 2026-10-18). The free Hobby plan is "for personal, non-commercial use" (same page), so the demo fits it only while it stays a personal portfolio piece.
- Risk: platform lock-in on a few features (image optimization, analytics); usage-based billing needs a spend cap.

**B. Cloudflare Workers through the OpenNext adapter, or Netlify.**
- Fit: cheaper at scale (Cloudflare), global edge.
- Risk: Next.js support comes through an adapter that trails framework releases, so features in ADR 0001 may lag. More moving parts for a client with no engineers.

**C. A container on Fly.io, Render, or AWS running `next start`.**
- Fit: full control, predictable pricing.
- Risk: the client owns scaling, patching, and uptime, which a team with no engineers cannot do. The spike in PRD-70 needs capacity planning.

## Recommendation

**A: Vercel and GitHub Actions.**
- **CI:** GitHub Actions runs the SET-17 gates (format, lint, typecheck, test, build) and the ADR 0006 per-PR checks, with `permissions:` set to the minimum. Preview deploys come from the Vercel GitHub integration.
- **Redirects:** the redirect map for PRD-64 lives in config generated from the migration list; if the list runs to thousands, use the platform's bulk redirects ([docs](https://vercel.com/docs/redirects)).
- **Scheduled jobs:** reminders (PRD-27), gift delivery and expiry (PRD-33), weekly host transfers (ADR 0003), hold cleanup (ADR 0002), and the daily balance reconciliation. Hobby runs cron once a day with up to 59 minutes of imprecision, so the real job needs Pro's per-minute cron (or a queue service behind a wrapper). The demo triggers these jobs from a protected route with a date argument.
- **Region:** functions in US East, next to the database (ADR 0002). Region loss is covered by the independent hourly database dump in ADR 0002, plus a redeploy from `main`.
- **Measurement and monitoring (amended 2026-10-18, Dave).** Each vendor sits behind a wrapper (ARCH-8).
  - **Funnel and attribution events (PRD-15, PRD-58, PRD-61, G4):** a first-party `events` table in Postgres (ADR 0002). Checkout starts and confirmed bookings are written on the server, in the Server Actions. Page and experience views come from a small first-party beacon in the browser (`navigator.sendBeacon` to Ramble's own endpoint), because cached pages (ADR 0001) don't run server code on every view. Each event carries a session ID, the attribution source (newsletter issue or campaign parameters), and the subscriber ID only where the subscriber consented. The investor report (PRD-59), funnel counts (PRD-61), the dashboard (PRD-60), and cohorts (PRD-62) are SQL views over it. No third-party analytics script. Alternative: PostHog behind a wrapper, if the head of growth wants self-serve funnels and cohorts; it adds a client script and consent questions.
  - **Web vitals (PRD-68 field check):** Google's `web-vitals` library, attribution build, reporting LCP, INP, and CLS (with TTFB and FCP) and their attribution to Ramble's own endpoint, on every page including checkout. On checkout it is listed in the PCI script inventory as an approved first-party script (ADR 0003). This gives the 75th percentile by page and device, and the attribution data the Perf Lab branch needs. Vercel Speed Insights stays as the hosted summary, off the checkout page.
  - **Endpoints:** the event and vitals endpoints are public Route Handlers, so each validates its input with a schema, is rate limited, and accepts no personal data beyond the consented subscriber ID (SEC-2, SEC-5). At demo traffic every beacon is kept; for the real job, sample or batch if volume or database compute cost calls for it.
  - **Errors:** Sentry behind a wrapper. Its browser script stays off checkout; server-side capture covers checkout errors.
  - **Uptime (PRD-71):** a scheduled synthetic test booking from GitHub Actions or a monitoring service.
  - **Consent (PRD-73):** the events and vitals are first-party with no ad or cross-site tracking. What New York and US law require for them is an open item, not yet researched.
- **Secrets:** environment variables in Vercel and GitHub, read and validated once at start-up (SET-18, SET-19); `.env.example` committed.
- **Repository** [proposed]: public on GitHub, created when the plan is frozen in P4, so the freeze tag and every unit's pull request are on the record for the package. Creating it is Dave's gate.

## Amendment 2026-10-18: hosting tier, repo, domain, operations, and delivery

Accepted by Dave with the [industry-gap review](research/industry-gap-review.md) (decisions D1 to D4).

**Decisions**
- **D1, repo:** private until the plan freeze, then public. That makes CodeQL, secret push protection, branch rulesets, and unlimited GitHub Actions minutes free.
- **D2, hosting tier:** the demo stays on Vercel Hobby. Vercel's fair-use page lists "requesting or processing payment" as commercial use, so the demo checkout states that no payment is taken, and the gateway is fake (ADR 0003). The real job is planned on Pro.
- **D3, domain:** none for the demo. It runs on a `*.vercel.app` address. Email goes to the dev mailbox (ADR 0002), and the status page uses the monitoring vendor's address. Real email, a branded status page, and Search Console need a domain later.

**Scheduling: one demo pulse.** One scheduled call every 30 minutes runs all due work (job tick, synthetic booking, timing checks, dump trigger) in a single invocation, from a GitHub Actions scheduled workflow once the repo is public. Until then, and as a fallback, jobs run from the protected manual trigger. Hobby's daily cron stays as a safety net. The real job uses Pro's per-minute cron.

**Monitoring stack, one tool per job** (each behind a wrapper): Sentry for errors (free Developer plan); Better Stack's free plan for uptime checks, job heartbeats, and the status page; Axiom's free plan for warning and error logs beyond Hobby's one hour; a logger wrapper writing JSON with request and trace IDs and a redaction list. Axiom's free-plan terms for commercial use are unconfirmed.

**Security at the edge:** Vercel's platform DDoS protection; firewall rules (Hobby allows one rate-limit rule, so both beacons share a path prefix); BotID Basic on reserve, sign-in, and forms, kept off checkout; a two-tier CSP (nonce-based on dynamic routes, report-only on cached pages) with the full security header set; Secret-type environment variables, a rotation runbook, and MFA on every vendor account; gitleaks, Dependabot, and OSV-Scanner now, CodeQL and push protection once public; `security.txt`.

**Environments and delivery**
- A Neon branch per preview, expiring after 7 days (Neon Free allows 10); staging as a branch-based preview with the scale fixture; curated seed for local and previews, reference data only in a real production.
- Drizzle migrations committed, a drift check per PR, then migrate preview, staging, and production in order; expand then contract.
- **Releases change:** production is a staged deployment, smoke-tested, then promoted with a printed command, Dave's gate 5 (ADR 0010). This replaces "production on merge to `main`" above. Rollback has a runbook; Hobby rolls back to the previous deployment only.
- No deploys during live demos (no Skew Protection on Hobby), and the newsletter deploy freeze (ADR 0001).

**Operations:** a written SLO for PRD-71 (43 minutes of downtime a month, vendor-caused downtime reported separately); timing checks for the 5-minute email promises; about ten one-page runbooks linked from alerts, with one rehearsal before launch; ops switches in the admin (ADR 0002).

**Tier B, for the real job:** Vercel Pro features, Neon Launch, Resend Pro with a sending domain, a helpdesk, paging, synthetic browser checks, a pen test, and vendor accounts owned by the client. Costs are in the review.

## What would change the call

- The demo needs real scheduled jobs (not manual triggers): move the demo to Pro.
- Monthly hosting cost for the real job approaches a meaningful share of the $8k budget: price Cloudflare through OpenNext against the actual traffic.
- A required framework feature is unavailable on Vercel: unlikely, but would reopen B or C.
- Dave wants the repo private until launch: create it private at plan freeze and switch it to public later.
