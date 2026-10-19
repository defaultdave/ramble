# Observability, environments, and delivery

Researched 2026-10-18 for the Ramble industry-gap review.

Scope: logging, tracing, alerting and on-call, status page, error budget for PRD-71, runbooks, preview and staging environments, seed data per environment, migrations in CI, release and rollback, feature flags. It builds on ADRs 0001 to 0010 and does not reopen them.

Conventions: every price, limit, and capability below was read on 2026-10-18 from the linked page ("as of 2026-10-18"). Where the vendor printed a page date, the Sources table gives it. "UNCONFIRMED" marks anything I could not verify. Effort: S is under a day, M is one to three days, L is a week or more. "Demo" means Vercel Hobby plus free tiers. "Real job" means Vercel Pro, as ADR 0007 already plans.

## Summary

- **Hobby cannot observe itself.** Runtime logs last 1 hour, drains and alerts are not available, and cron runs once a day with up to 59 minutes of drift ([limits](https://vercel.com/docs/limits), [drains](https://vercel.com/docs/drains), [alerts](https://vercel.com/docs/alerts), [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)). The demo can show the design with free vendor tiers, but the real job needs Pro plus Observability Plus on day one (30-day logs, anomaly alerts).
- **Scheduled jobs fail silently.** Vercel does not retry a failed cron, delivery is best effort, and a missed run leaves no log ([cron docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)). Reminders (PRD-27), gift delivery (PRD-33), weekly host transfers (ADR 0003), and the hourly dump (ADR 0002) all ride on cron. No ADR monitors them. A heartbeat per job plus reconciliation-style handlers closes this for about a day of work.
- **PRD-71's 99.9% is 43.2 minutes of downtime in a 30-day month**, and the platforms underneath do not promise that much. Vercel publishes a 99.99% SLA only in an Enterprise agreement ([SLA](https://vercel.com/legal/sla)); Neon's 99.95% SLA is listed for Scale only on its plans page ([plans](https://neon.com/docs/introduction/plans)). If each of the two meets 99.95%, together they use the whole budget. PRD-71 needs a written SLI, an exclusions list, and a budget policy.
- **The synthetic booking in ADR 0007 needs a design.** GitHub Actions schedules run at most every 5 minutes, can be delayed, and a 5-minute probe is 8,640 runs a month against 2,000 free minutes on a private repo ([schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)). Stripe pairs test cards with test API keys and bars testing live mode with real card details ([Stripe testing](https://docs.stripe.com/testing)), so a live-mode probe needs a dedicated synthetic experience and a guarded route that stubs the payment step.
- **A team with no engineers still needs a named first responder.** Pick one tool for monitors, heartbeats, status page, and paging, and decide who answers at 7 am on a newsletter Sunday. That decision belongs to the client and the $8k retainer (C-01, C-04). I propose a new open question (Q-23).
- **Delivery is the larger gap.** No ADR says how Drizzle migrations reach a database, how many Neon branches previews may use (Free allows 10 per project, [plans](https://neon.com/docs/introduction/plans)), where staging lives, how production is promoted, or what rollback does to the schema. Staged production deployments and expand-then-contract migrations work on every plan. Skew Protection, which matters for a 10-minute checkout hold, is Pro-only ([docs](https://vercel.com/docs/skew-protection)).
- **Feature flags split into two jobs.** Release flags and experiments (engineer-owned, short-lived) fit Vercel Flags, which went GA on 2026-04-17 ([announcement](https://community.vercel.com/t/vercel-flags-is-now-generally-available/38589)). Ops switches such as "gift sales off" belong in the in-app admin with an audit row, because the people who flip them are not engineers. The stack decision of "no flag vendor" should be amended.
- **Order of magnitude for the real-job stack:** about $200 a month at list prices, before Neon and Vercel usage (Better Stack 3 responders $102, Sentry Team $29, Axiom Cloud $25, Vercel seat $20, plus a few dollars each for Observability Plus, drains, flags). That is under 3% of the $8k retainer. This is an estimate from the prices cited below.

## What Hobby cannot do

The demo runs on Hobby. This table shows what the real job gets by moving to Pro and what the demo does instead.

| Capability | Hobby | Pro | Demo workaround |
|---|---|---|---|
| Runtime logs | [1 hour](https://vercel.com/docs/logs/runtime) | 1 day; 30 days with [Observability Plus](https://vercel.com/docs/observability/observability-plus) ($1.20 per 1M events) | Ship app logs to a free log vendor from the logger wrapper |
| Log, trace drains | [Not available](https://vercel.com/docs/drains) | Available, $0.50 per GB | Same as above |
| Alerts | [Not available](https://vercel.com/docs/alerts) (needs Observability Plus) | Error and usage anomaly alerts to email, Slack, webhook | External monitor alerts |
| Cron | [Once a day, hour-level precision](https://vercel.com/docs/cron-jobs/usage-and-pricing) | Once a minute | Protected route triggered by hand (ADR 0007) |
| Instant Rollback | [Previous deployment only](https://vercel.com/docs/instant-rollback) | Any deployment that served production | Same, one step back |
| Custom environment (staging) | [No](https://vercel.com/docs/deployments/environments) | 1 per project at no cost | Branch-based staging (all plans) |
| Skew Protection | [No](https://vercel.com/docs/skew-protection) | Yes | Avoid deploying during demos |
| Rolling Releases (canary) | [No](https://vercel.com/docs/rolling-releases) | 1 project | Not shown |
| Deployments per day, concurrent builds | [100 per day, 1 build at a time](https://vercel.com/docs/limits) | 6,000 per day, up to 500 concurrent | Queue agent PRs; preview only ready PRs |
| Deployment retention | [30 days, last 3 production kept](https://vercel.com/docs/deployment-retention) | 180 days preview, 1 year production, last 20 kept | None needed |
| Always-on tracing (Beta) | [1M span units a month, 1 hour retention](https://vercel.com/docs/tracing/always-on-tracing) | $0.50 per 1M span units, 1 day retention | Same, as a demo |
| Speed Insights | [10,000 events per 30 days, shared; collection pauses at the cap](https://vercel.com/docs/speed-insights/limits-and-pricing) | Plus: $10 per project plus $0.65 per 10,000 events | First-party web-vitals endpoint stays the source of truth (ADR 0007) |
| Vercel Flags | [10,000 flag requests a month, 100 flags](https://vercel.com/docs/flags/vercel-flags/limits-and-pricing) | $0.03 per 1,000 flag requests | Static provider in CI and load tests |
| Git repo owner | [Personal account repos only; org-owned repos are not supported](https://vercel.com/docs/limits) | Org repos | Repo is `defaultdave/ramble`, so fine for the demo |
| Terms | [Personal, non-commercial use](https://vercel.com/pricing) | Commercial | Demo stays a portfolio piece |

## Capability table

| Capability | Why Ramble needs it (PRD or norm) | Coverage today | Real-job pick | Free demo option and its limits | Effort | When |
|---|---|---|---|---|---|---|
| Structured logging with redaction and correlation IDs | SEC-11 bans secrets and personal data in logs; PRD-73; norm: one request ID joins a guest complaint to a log line | gap (no ADR names a logger) | One `logger` wrapper (ARCH-8): JSON to stdout, request ID, trace ID, order ID, no emails, redaction list inside the wrapper | Same wrapper; Hobby keeps 1 hour of logs ([source](https://vercel.com/docs/logs/runtime)) | S | launch-critical |
| Log retention and search past platform defaults | Incident forensics for PRD-71; norm: 30 days searchable; Vercel logs show cache HIT or MISS and a reason, useful for the Cache Components checks (ADR 0001) | gap | Pro plus Observability Plus (30 days) at launch; add a drain to Axiom Cloud ($25 a month plus usage, [pricing](https://axiom.co/pricing)) when logs must outlive 30 days or drive alerts | Wrapper sends warn, error, and business events by OTLP/HTTP to Axiom Personal (500 GB a month ingest, 30-day retention, [pricing](https://axiom.co/pricing)) inside `after()`. App logs only; commercial-use terms UNCONFIRMED | M | launch-critical (Plus), before scale (drain) |
| Tracing with OpenTelemetry | PRD-68 and PRD-70 diagnosis under spikes; PRD-22 follow one payment from action to webhook to ledger | gap (ADR 0006 has k6 only; ADR 0007 names Sentry only) | `@vercel/otel` in `instrumentation.ts`, custom spans on hold, payment, webhook, email; Vercel always-on tracing at 10% sample ([Beta, $0.50 per 1M span units, 1 day retention](https://vercel.com/docs/tracing/always-on-tracing)); Sentry set to custom-OTel mode for errors only | Hobby always-on tracing: 1M span units, 1 hour retention. Grafana Cloud free takes OTLP: 50 GB traces, 14 days ([pricing](https://grafana.com/pricing/)) | M | before scale (span names at skeleton) |
| Error tracking | PRD-71, RK-04 | covered (ADR 0007: Sentry, browser script off checkout) | Keep Sentry. Team plan $29 a month: 50k errors, 90-day lookback ([pricing](https://sentry.io/pricing/)). Tag releases with the Vercel deployment ID; upload source maps in CI | Developer plan: 5k errors, 1 user, 30 days, 1 cron monitor, 1 uptime monitor ([pricing](https://sentry.io/pricing/)) | S | launch-critical |
| Real-user vitals and funnel events | PRD-61, PRD-68 field check | covered (ADR 0007, 0006) | No change. Note Speed Insights free caps at 10,000 events per 30 days and pauses ([source](https://vercel.com/docs/speed-insights/limits-and-pricing)); the first-party endpoint carries the numbers | Same | none | none |
| Uptime and the synthetic booking probe | PRD-71 defines "up" as page loads and a test booking completes | partial (ADR 0007, 0006: "a scheduled synthetic test booking") | External monitor: 1-minute HTTP checks on the experience page and a health route, plus a 5-minute call to a guarded `/api/synthetic/booking` route on a dedicated synthetic experience that writes `synthetic_runs` | Better Stack free: 10 monitors, 10 heartbeats, 3-minute checks, Slack and email only ([page](https://betterstack.com/better-uptime)). Do not run it from GitHub Actions on a private repo | M | launch-critical |
| Scheduled-job heartbeats | PRD-27, PRD-33, ADR 0003 weekly transfers, ADR 0002 hourly dump; Vercel does not retry a failed cron ([docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)) | gap | Each job pings success or fail; handlers reprocess everything since the last success. Better Stack heartbeats (same tool) or Healthchecks.io Business $20 a month ([pricing](https://healthchecks.io/pricing/)) | Healthchecks.io Hobbyist: 20 checks free, no SMS or phone ([pricing](https://healthchecks.io/pricing/)); the demo's manual triggers ping too | S | launch-critical |
| Operational SLIs for timing promises | PRD-25, 27, 28, 33, 44 promise minutes; PRD-70 needs 99% of checkouts to complete | gap (targets exist, nothing measures them) | Timestamps in Postgres (booking confirmed, email sent, webhook received); a scheduled check computes lag and pings a heartbeat or fails; SQL views for the dashboard | Same, free (Postgres plus a heartbeat) | M | launch-critical (email and webhook lag), before scale (rest) |
| Alerting and on-call (C-04) | Nobody on the client side can fix an outage; the build partner must be paged | gap | One paging tool. Better Stack responder licenses $34 a month ($29 annual) ([pricing](https://betterstack.com/pricing)) or PagerDuty Professional $25 per user ([pricing](https://www.pagerduty.com/pricing/incident-management/)). Vercel anomaly alerts (Pro plus Observability Plus) feed it | Better Stack free: Slack and email only. PagerDuty free: 5 users, 100 SMS or phone notifications a month, 1 schedule ([pricing](https://www.pagerduty.com/pricing/incident-management/)) | M | launch-critical |
| Status page | RK-04 support load; PRD-54 help pages should link to it; norm for any payments site | gap | Better Stack status page (1 included, extra $15 a month), on its own domain and infrastructure; Instatus Pro is the alternative | Better Stack free: 1 status page. Instatus Starter: free, 200 subscribers, no custom domain ([pricing](https://instatus.com/pricing)). Upptime: GitHub Actions plus Pages, 5-minute checks ([site](https://upptime.js.org/)) | S | launch-critical |
| SLO and error budget for PRD-71 | PRD-71 gives a target and no way to account for it | gap | SLI spec, exclusions, 43.2-minute monthly budget, burn-rate alerts, and a freeze policy adapted from the [SRE workbook](https://sre.google/workbook/error-budget-policy/); monthly report from `synthetic_runs` | Same, a SQL view over seeded probe history | S | launch-critical (definition), before scale (policy automation) |
| Runbooks and incident process | RK-04, PRD-75 (restore rehearsal in ADR 0002); a non-engineering client cannot improvise | gap | Ten runbooks in `docs/runbooks/`, each linked from its alert; severity matrix; postmortem template; one rehearsal before launch | Same Markdown files; they are part of the planning method on show | M | launch-critical |
| Spend and usage guardrails | ADR 0007 notes billing is usage-based and needs a cap; newsletter spikes | partial | Vercel Spend Management (notify or pause by webhook, Pro, [docs](https://vercel.com/docs/speed-insights/limits-and-pricing)); usage anomaly alerts; Neon CU-hour watch | Hobby cannot buy extra usage, so overspend cannot happen ([pricing](https://vercel.com/pricing)); Neon Free is 100 CU-hours a project ([plans](https://neon.com/docs/introduction/plans)) | S | launch-critical (cap) |
| Preview deploys with per-preview DB branch | ADR 0006 gates; ADR 0002 concurrency test on a branch; agent fan-out (ADR 0010) opens many PRs | partial (branch named, no mechanism, cap, or cleanup) | Neon Launch ($0.106 per CU-hour, 10 branches included, extra $1.50 per branch-month, [plans](https://neon.com/docs/introduction/plans)); branches created with an expiry; deleted on PR close | Neon Free: 10 branches per project, 100 CU-hours, no extra branches. Previews only for PRs marked ready | M | launch-critical |
| Staging environment | Rehearse migrations and run k6 (PRD-70) without touching production | gap | Vercel custom environment `staging` (Pro: 1 per project, no extra cost, [docs](https://vercel.com/docs/deployments/environments)), Neon `staging` branch with the scale fixture, Stripe sandbox | Branch-based staging works on Hobby ([docs](https://vercel.com/docs/deployments/environments)); Neon `staging` branch uses 1 of 10 slots | S | launch-critical |
| Seed data per environment | ADR 0008 defines content, not where it loads | partial | Policy table (below): production gets reference data only; the seed script refuses to run in production | Demo production holds the curated seed, labeled as a demo | S | launch-critical |
| Database migrations in CI | PRD-22, PRD-71 (zero planned downtime), PRD-75 | gap | `drizzle-kit generate` committed, drift and `check` gates per PR, migrate on branch, staging, then production over the unpooled URL, expand then contract, forward-only fixes | Same pipeline against Neon Free branches | M | launch-critical |
| Release promotion | PRD-71; Dave's gate 5 on deploys (ADR 0010) | partial (ADR 0007: production on merge to `main`) | Staged production deployment (auto-assign off), migrate, smoke the staged URL, promote with a printed command; Rolling Releases once traffic justifies it ([docs](https://vercel.com/docs/rolling-releases)) | Staged deployments work on all plans ([docs](https://vercel.com/docs/deployments/promoting-a-deployment)) | M | launch-critical |
| Rollback | PRD-71; norm: rollback in under 5 minutes | gap | Instant Rollback to any prior production deployment ([docs](https://vercel.com/docs/instant-rollback)) with a compatibility rule: code N-1 must run on schema N | Hobby: previous deployment only | S | launch-critical |
| Version skew during deploys | PRD-16, PRD-20: a guest mid-checkout holds spaces for 10 minutes | gap | Pro Skew Protection on, with checkout pinned for the session ([docs](https://vercel.com/docs/skew-protection)) | Not available on Hobby; do not deploy during demos | S | launch-critical |
| Release flags and experiments | A-02 conversion test; safe rollout of checkout changes | gap (stack decisions: no flag vendor) | Vercel Flags through the Flags SDK behind a `flags` wrapper, OpenFeature-shaped. Pro $0.03 per 1,000 flag requests ([limits](https://vercel.com/docs/flags/vercel-flags/limits-and-pricing)) | Hobby: 10,000 requests, 100 flags; static env provider for CI, k6, and Lighthouse | M | before scale |
| Ops switches (kill switches) | PRD-33 gift-law risk (ADR 0002), PRD-17 proposed values, Express Checkout failures; flipped by ops | gap | Settings table plus in-app admin, audit row per change (PRD-74), tag revalidation; same mechanism ADR 0002 uses for gift validity | Same, free | M | launch-critical |

## Environments and seed policy

| Environment | Vercel | Database | Payments | Data | Flags | Notes |
|---|---|---|---|---|---|---|
| Local | `next dev` | Neon branch `dev-<name>` or local Postgres | fake gateway | curated seed, deterministic ([drizzle-seed](https://orm.drizzle.team/docs/seed-overview) takes a seed number) | static | `.env.example` only (SET-18) |
| Preview (per PR) | Preview | Neon branch `preview/<git-branch>` from the `staging` parent, 7-day expiry | fake gateway | inherited from parent | static | Needs a protection bypass for CI (below) |
| Staging | Pro: custom environment. Hobby: preview branch `staging` | Neon `staging` | Stripe sandbox | curated plus 400-experience scale fixture (ADR 0008) | live provider, test project | k6 and migration rehearsal run here |
| Production | Production | Neon primary | Stripe live (real job); fake gateway or sandbox (demo, ADR 0003) | Real job: reference data only (categories, neighborhoods, tax treatments). Demo: curated seed, labeled | live provider | Seed script exits if `VERCEL_ENV=production` unless a demo flag is set |

Rules: no production data is copied to a lower environment. If a realistic copy is ever needed, Neon's data masking can build an anonymized branch, but it is Beta, cannot be reset or restored, and cannot mask foreign keys directly ([docs](https://neon.com/docs/workflows/data-anonymization)). Mark it "later".

## Gap sections

### G1. Log shipping and retention

Prices as of 2026-10-18.

| Option | Cost | Fit | Risk |
|---|---|---|---|
| Vercel logs only | Hobby 1 hour; Pro 1 day ([source](https://vercel.com/docs/logs/runtime)) | Fine for live debugging | Cannot investigate yesterday's failed booking |
| Pro plus Observability Plus | $1.20 per 1M events; 30 days, 14-day selection window ([source](https://vercel.com/docs/observability/observability-plus)); on by default for teams created or upgraded to Pro on or after 2026-04-03 | No extra vendor; includes anomaly alerts | Events count CDN requests and static assets, so volume is hard to predict. At 10M events a month the cost is $12 (arithmetic from the rate) |
| Vercel drain to Axiom or Better Stack | Drains $0.50 per GB ([source](https://vercel.com/docs/drains)); Axiom Cloud $25 a month; Better Stack log drains need Vercel Pro ([source](https://betterstack.com/docs/logs/vercel/)) | Long retention, log-based alerts, static request logs | A second bill. Axiom itself notes direct shipping can be cheaper at volume ([source](https://axiom.co/docs/apps/vercel)) |
| Direct OTLP from the wrapper | Axiom accepts logs, traces, metrics over OTLP/HTTP with a bearer token ([source](https://axiom.co/docs/send-data/opentelemetry)) | Works on Hobby; one wrapper | Misses platform logs; must flush after the response, which `after()` supports through `waitUntil` ([source](https://nextjs.org/docs/app/api-reference/functions/after)) |

**Pick:** Pro plus Observability Plus at launch; a drain to Axiom when the first dispute or audit needs more than 30 days. Dispute evidence lives in Postgres (ledger, events, audit table, ADR 0002), so logs do not need to match the 120-day dispute window in ADR 0003. That is an inference from the ADRs.
**Demo:** direct OTLP to Axiom Personal. The 500 GB figure is printed as "data loading compute" on the pricing page; treat it as an upper bound.

### G2. Tracing

| Option | Cost | Fit | Risk |
|---|---|---|---|
| Sentry tracing only | 5M spans on Developer and Team ([source](https://sentry.io/pricing/)) | One tool for errors and traces | Couples tracing to one vendor; ARCH-8 wrapper still applies |
| `@vercel/otel` plus Vercel always-on tracing | Beta; Hobby 1M span units; Pro $0.50 per 1M; retention 1 hour or 1 day ([source](https://vercel.com/docs/tracing/always-on-tracing)) | Next.js emits route, render, fetch, and handler spans by default ([source](https://nextjs.org/docs/app/guides/open-telemetry)); vendor-neutral | Retention is short; Beta |
| `@vercel/otel` plus trace drain to Axiom or Grafana | Drain $0.50 per GB; Grafana Cloud free 50 GB traces, 14 days ([source](https://grafana.com/pricing/)) | Long retention | More plumbing |

**Pick:** `@vercel/otel` with custom spans on the hold, payment, webhook, and email paths, sampled at 10% in production. Sentry runs in custom-OTel mode so the two do not fight: Vercel's tracing page warns that Sentry v8+ sets up its own OpenTelemetry and can break trace propagation ([source](https://vercel.com/docs/tracing)). The option name differs between the two vendors' docs (`skipOpenTelemetrySetup` on Vercel's page, `enableOpenTelemetrySetup: false` on [Sentry's](https://docs.sentry.io/platforms/javascript/guides/nextjs/opentelemetry/custom-setup/)), so confirm against the installed SDK. Custom spans from Edge runtime functions do not appear ([source](https://vercel.com/docs/tracing)); the booking path stays on the Node runtime.
**UNCONFIRMED:** neither `@vercel/otel` nor the Sentry SDK states support for Next.js 16.4 with Cache Components in the pages I read. Test at the walking skeleton.

### G3. Alerting and on-call without engineers

| Option | Cost | Fit | Risk |
|---|---|---|---|
| Better Stack (monitors, heartbeats, status page, on-call) | Free: Slack and email only. Responder $34 monthly or $29 annual; extra status page $15 ([pricing](https://betterstack.com/pricing)) | One vendor, one bill, one login for the client | "Unlimited voice call alerts" is advertised but the plan is not stated on the page I read ([page](https://betterstack.com/better-uptime)); confirm phone calls before buying |
| PagerDuty | Free: 5 users, 100 SMS or phone a month. Professional $25 per user monthly, $21 annual ([pricing](https://www.pagerduty.com/pricing/incident-management/)) | Mature paging and escalation | Separate from monitors; the free tier's 100 notifications can run out in one bad weekend |
| incident.io | Basic is free with a status page and single-team on-call; on-call add-on $10 per user on Team, $20 on Pro ([pricing](https://incident.io/pricing)) | Incident workflow in Slack | Adds a workflow tool a six-person team may not use |
| Grafana Cloud IRM | Free tier lists 3 IRM users ([pricing](https://grafana.com/pricing/)), but the IRM docs call it a paid add-on ([docs](https://grafana.com/docs/grafana-cloud/alerting-and-irm/irm/)); UNCONFIRMED | Pairs with Grafana synthetics | Conflicting sources |
| Opsgenie | End of sale 2025-06-04, end of support 2027-04-05 ([source](https://www.atlassian.com/licensing/opsgenie)) | None | Ruled out |

**Pick:** Better Stack for the single tool, with PagerDuty Professional as the fallback if phone calls are not on the Better Stack plan. Three responders cost $102 a month monthly ($87 annual).
**Who is on call** is a client decision. I propose the build partner on the retainer is first responder, the COO gets a non-paging copy, and the response window covers the three hours after each newsletter send (PRD-70). The newsletter started as a Sunday send (PRD section 2); confirm the current send day.

| Severity | Example | Paged | Target response (proposed) | Status page |
|---|---|---|---|---|
| SEV1 | Booking probe failing 2 runs in a row; possible double charge; checkout 5xx burn | Build-partner on-call by phone; COO by SMS | Acknowledge in 15 minutes, any hour a send is live; 1 hour otherwise | Yes |
| SEV2 | Emails later than 5 minutes (PRD-25, 28); missed cron; webhook backlog | Build-partner on-call by push or SMS | 2 hours in the 7 am to 10 pm window | If guest-visible |
| SEV3 | Search degraded, slow page, one failed email | Ticket | Next business day | No |

### G4. The synthetic booking probe

PRD-71 says "up" means an experience page loads and a test booking completes.

| Option | Cost | Fit | Risk |
|---|---|---|---|
| GitHub Actions schedule | 8,640 runs a month at 5 minutes. Free minutes: 2,000 on a private repo, unlimited on public ([billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)). Per-job rounding UNCONFIRMED | Already in the stack | 5-minute minimum, can be delayed under load, only runs on the default branch, and in a public repo it is disabled after 60 days without activity ([source](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). ADR 0010 made the repo private |
| Hosted browser check (Checkly) | Hobby: 1,000 browser runs (about one every 43 minutes) or 10,000 API runs (about one every 4.3 minutes), 2-minute minimum, email, Slack, webhook only. Starter $24: 1-minute frequency, 25,000 API runs ([pricing](https://checklyhq.com/pricing)) | Real browser path | Browser quota too small on free |
| Monitor calls a guarded route | Better Stack free: 3-minute checks ([page](https://betterstack.com/better-uptime)) | Cheap, deterministic, and the route writes `synthetic_runs` for the budget | Does not exercise the browser; pair with a weekly Playwright run |
| Grafana Cloud synthetic | Free: 100k API and 10k browser executions a month ([pricing](https://grafana.com/pricing/)); free-tier terms for synthetics UNCONFIRMED | Scripted browser path about every 4.3 minutes | Another vendor |

**Pick:** a monitor that calls a guarded route, plus the existing nightly Playwright suite (ADR 0006) for the browser path.
**Design points:**
- **Live money.** Stripe's docs say to use test keys with test cards, and the services agreement bars testing live mode with real card details ([source](https://docs.stripe.com/testing)). So the synthetic experience takes a code path that runs hold, order, confirm, and cancel with the payment step stubbed for the synthetic host only. The payment provider is monitored separately (webhook lag, ADR 0003's daily reconciliation).
- **Denominator.** Exclude the synthetic host from GMV, the investor report, and host emails (PRD-59), and from capacity.
- **Counting.** A minute is down when two consecutive probes fail from two locations (proposed).

### G5. SLO and error budget for PRD-71

| Month length | Allowed downtime at 99.9% |
|---|---|
| 28 days | 40.3 minutes |
| 30 days | 43.2 minutes |
| 31 days | 44.6 minutes |

With a 5-minute probe, 8.64 failed runs a month is the budget. A 14.4x burn alert on a 1-hour window ([SRE workbook table](https://sre.google/workbook/alerting-on-slos/): page at 14.4x over 1 hour and 5 minutes, 6x over 6 hours and 30 minutes, ticket at 1x over 3 days and 6 hours) corresponds to a 1.44% error ratio, and a single failed 5-minute probe is 8% of an hour's probes. So probe results page on consecutive failures, and the burn-rate table applies to a request-based SLI on the booking path. At the forecast of about 1,800 bookings a month (PRD section 4) request volume is low and noisy, which is an inference; start with probes and add request ratios after launch.

**Dependency math.** Vercel Pro has no published SLA; the Enterprise SLA is 99.99% with service credits as the only remedy ([source](https://vercel.com/legal/sla)). Neon's SLA is 99.95%, covers compute endpoint availability only, and applies to Scale (and Business on the SLA page) ([SLA](https://neon.com/neon-business-sla), [plans](https://neon.com/docs/introduction/plans)). Two components at 99.95% give 0.9995 x 0.9995 = 99.90%, which leaves no room for Ramble's own bugs. Options for the client:
1. Treat 99.9% as Ramble's measured target, say so in the contract, and report actuals.
2. Pay for Neon Scale ($0.222 per CU-hour versus $0.106 on Launch) to hold a contract behind the database half.
3. Ask Vercel for Enterprise terms later if the contract needs it.

**Policy (adapted from Google's example, [source](https://sre.google/workbook/error-budget-policy/); values proposed):**
- A single incident that uses more than 20% of the monthly budget (about 9 minutes) needs a postmortem with at least one action item.
- When the month's budget is spent, only security fixes and rollbacks ship until the next month starts or the build partner and Dave agree otherwise.
- Planned maintenance is not excluded by PRD-71, so migrations must be expand-then-contract and deploys must not interrupt checkout.
- Excluded: disaster recovery (PRD-75, already excluded), load tests, and the synthetic host.

### G6. Scheduled jobs and timing promises

Facts from the [cron docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs): no retry on failure; delivery is best effort and a missed run writes no log; the same run can be delivered twice; a second instance can start if a run overlaps; redirects are not followed.

**Pick:**
- Every handler is idempotent and reconciliation-based (process all work since the last success), as the docs recommend, and takes a lock.
- Every job pings a heartbeat on success and a fail URL on error. A missing ping pages after one interval plus grace.
- An SLI job (G7 row "Operational SLIs") measures confirmation email lag, reminder lateness, gift email lag, webhook-to-ledger lag, hold-sweeper age, and the oldest unprocessed provider event. It fails when a PRD promise is broken.
- Stripe retries live-mode webhooks for up to three days, but sandbox deliveries retry only three times over a few hours ([source](https://docs.stripe.com/webhooks)). The demo on a sandbox (ADR 0003) needs the reconciliation job to catch what retries miss.

### G7. Status page

| Option | Cost | Fit | Risk |
|---|---|---|---|
| Better Stack | 1 page free; extra $15 monthly ([pricing](https://betterstack.com/pricing)); custom domain on free UNCONFIRMED | Same tool as monitors | Vendor concentration |
| Instatus | Starter free: 200 subscribers, 15 monitors, 2 on-call members, no custom domain. Pro "from $20" ([pricing](https://instatus.com/pricing)) | Separate from monitors | Pro price not shown in page body |
| Atlassian Statuspage | Free: 100 subscribers, 25 components, 2 team members; Hobby $29 ([pricing](https://www.atlassian.com/software/statuspage/pricing)) | Familiar | Pricier for what Ramble needs |
| Upptime | Free; 5-minute checks via GitHub Actions ([site](https://upptime.js.org/)) | Fits the demo | Same Actions limits as G4 |

**Pick:** Better Stack. Host it on its own domain and DNS so an outage on Vercel does not take the status page with it (inference). Link it from every email footer and the help pages (PRD-54). The audience is hosts and guests, so keep component names plain: "Booking", "Payments", "Emails".

### G8. Runbooks

Ten runbooks, each one page, each linked from its alert. Format: trigger, first five minutes, who decides, how to confirm fixed, who to tell, links.

| # | Runbook | Draws on |
|---|---|---|
| 1 | Booking probe failing | G4 |
| 2 | Payments degraded or webhooks backing up | ADR 0003 reconciliation, Stripe event resend ([source](https://docs.stripe.com/webhooks): up to 15 days in the dashboard, 30 days by CLI) |
| 3 | Bad deploy: rollback, fix forward, undo rollback | G11 |
| 4 | Database: connection errors, Neon incident, restore | ADR 0002 item 12; Neon history window (Free 6 hours, paid up to 7 or 30 days, [plans](https://neon.com/docs/introduction/plans)) |
| 5 | Missed or duplicate cron | G6; demo's date-argument route (ADR 0007) |
| 6 | Emails late or not sending | PRD-25, 28, 76 |
| 7 | Hold or oversell anomaly (CHECK violation logged) | ADR 0002 |
| 8 | Newsletter send pre-flight and watch | PRD-70, Q-20 |
| 9 | Secret rotation | SET-18 |
| 10 | Comms templates: status page, host email, guest email | PRD-28 |

Rehearse numbers 3, 4, and 1 once before launch (PRD-75 already requires a restore rehearsal). Each postmortem is blameless, one page, with a "detected by" line so gaps in alerts show up.

### G9. Preview databases and the Neon branch cap

Neon branches are copy-on-write; a branch can be created from a past point and given an expiry ([docs](https://neon.com/docs/introduction/branching)). Free plan: 10 branches per project, no extras; Launch includes 10, then $1.50 per branch-month ([plans](https://neon.com/docs/introduction/plans), [pricing](https://neon.com/pricing)). A 7-day branch on Launch costs about $0.35 (arithmetic: $1.50 / 720 hours x 168 hours). Whether the primary branch counts toward the 10 is UNCONFIRMED; assume it does.

| Option | Cost | Fit | Risk |
|---|---|---|---|
| Vercel-managed Neon integration (ADR 0002's "through the Vercel Marketplace") | Billing through Vercel | A branch per preview, `DATABASE_URL` injected per deployment ([docs](https://neon.com/docs/guides/vercel-managed-integration)) | Branches are deleted when the Vercel deployment is removed, and the docs warn they can outlive the PR by months; Hobby does not appear in the page, so UNCONFIRMED |
| Neon-managed integration | Billing with Neon | Same `preview/<git-branch>` naming; optional "automatically delete obsolete branches" when the Git branch is deleted, run at the next preview deploy ([docs](https://neon.com/docs/guides/neon-managed-vercel-integration)) | Cannot coexist with the Vercel-managed one in a project |
| GitHub Actions create-branch action | Free | Takes `expires_at`, `parent_branch`, `branch_type: schema-only`; returns the existing branch if the name exists; outputs pooled and direct URLs ([README](https://github.com/neondatabase/create-branch-action)) | Needs a Neon API key secret; deletion needs a second action or the expiry |

**Pick:** Neon-managed integration for preview deploys, plus the Actions create-branch call in CI using the same name `preview/<git-branch>`, so tests and the preview share one branch (the action returns an existing branch of that name; combining the two is UNCONFIRMED, verify at the skeleton). Add `expires_at` of 7 days as a backstop and delete on PR close.
**Cap rules for the Free demo:** primary, `staging`, and one `dev` use 3 slots, leaving about 7. Create a preview branch only when a PR is marked ready for review or needs a database. CI integration tests (the hold concurrency test, ADR 0002 item 13) use a separate branch with a 2-hour expiry, deleted when the job ends. ADR 0010's fan-out can open more PRs than slots, so the PM checks the slot count before a batch.
**Preview access in CI:** Vercel Standard Protection applies to non-production URLs on all plans ([docs](https://vercel.com/docs/deployment-protection)), so Lighthouse CI and Playwright (ADR 0006) need a bypass for automation. Its availability on Hobby is UNCONFIRMED.

### G10. Staging and seed data

| Option | Plan | Fit | Risk |
|---|---|---|---|
| Custom environment `staging` | Pro (1 included) | Own variables, domain, branch tracking; Marketplace resources attach per environment ([docs](https://vercel.com/docs/deployments/environments)) | Only one on Pro |
| Preview branch `staging` with branch-scoped variables | All plans | Same effect | Variables apply at build; redeploy after changes ([KB](https://vercel.com/kb/guide/set-up-a-staging-environment-on-vercel)) |
| Staged production deployment | All plans | Production build, production variables, no traffic until promoted | Production variables mean production data; not a staging substitute |

**Pick:** custom environment on Pro, preview-branch staging on Hobby. Staging has its own Neon branch, Stripe sandbox, and the scale fixture, and it is where k6 runs (PRD-70). Production never receives the scale fixture.

### G11. Migrations in CI

Facts: Drizzle documents generate-then-migrate, push, runtime migrate, and external tools, and names no single production path; its pages do not mention down migrations ([docs](https://orm.drizzle.team/docs/migrations)). `drizzle-kit check` verifies migration history consistency, aimed at schema changes on diverging branches ([docs](https://orm.drizzle.team/docs/drizzle-kit-check)). Neon says migration tools should use a direct connection because the pooler runs in transaction mode ([docs](https://neon.com/docs/connect/connection-pooling)).

| Option | Fit | Risk |
|---|---|---|
| `drizzle-kit migrate` in the Vercel build command | Simplest | Runs on every preview and production build; a build that fails after migrating leaves schema ahead of code; cannot gate on a smoke test |
| Runtime `migrate()` on first request | Documented | Races across function instances; hides failures in user traffic |
| CI job, ordered: branch, staging, production | Gated, auditable, uses the direct URL | More workflow to write |
| `drizzle-kit push` | Fast | Not recommended for production by the sources I read; no migration files to review |

**Pick:** the CI job.
- **Per PR:** commit generated SQL; a step re-runs `generate` and fails on any diff (a third-party pattern, not in Drizzle's docs); run `check`; migrate the PR's Neon branch on `DATABASE_URL_UNPOOLED`; run integration tests.
- **After merge:** a workflow with a `concurrency` group so two runs cannot overlap migrates staging, runs the smoke suite, then migrates production with the same files, then reports the staged deployment as ready to promote (G12).
- **Rules:** every migration is backward compatible with the previous release (add nullable column, backfill, then enforce; drop or rename only one release later). A lint step flags `DROP`, `RENAME`, and `ALTER COLUMN ... TYPE` for a `destructive-migration` label. Set `lock_timeout` on the migration session. No down migrations: fixes go forward, and data loss is handled by Neon's history window (PRD-75).
- **Order of events matters:** production migrates before the new code is promoted, which is safe only because of the compatibility rule.

### G12. Release, rollback, and skew

| Release option | Plan | Fit | Risk |
|---|---|---|---|
| Merge promotes automatically (ADR 0007 today) | All | Fast | No gate between migration and traffic |
| Staged production deployment, then promote | All ([docs](https://vercel.com/docs/deployments/promoting-a-deployment)) | Promotion assigns domains without a rebuild; fits Dave's gate 5 (print `vercel promote`) | One more manual step |
| Rolling Releases | Pro, 1 project ([docs](https://vercel.com/docs/rolling-releases)) | Sends a fraction (for example 5%) to the new deployment, compares Speed Insights, abort by rollback | Needs Skew Protection; needs enough traffic to compare |
| Promote a preview (rebuild) | All | Escape hatch | Different env variables than production |

**Pick:** staged production plus promote at launch; Rolling Releases before scale, once weekly sends make a 5% canary meaningful.

**Rollback facts** ([docs](https://vercel.com/docs/instant-rollback)): environment variables are not re-evaluated; cron jobs revert to the rolled-back deployment's set; auto-assignment of production domains turns off until you "undo rollback" by promoting a deployment; only one rollback at a time; Hobby can only go back one deployment. The database is not rolled back, hence the N-1 compatibility rule in G11. Pro keeps the last 20 Ready production deployments and a year of history by default; Hobby keeps 3 ([retention](https://vercel.com/docs/deployment-retention)).

**Version skew.** Server Action IDs are regenerated per build and "actions can only be invoked for a specific build" ([Next.js](https://nextjs.org/docs/app/guides/data-security)). A guest who loaded checkout before a deploy and submits after it can hit a mismatch. Skew Protection (Pro) pins framework requests to the deployment that served the page, and Vercel names "long checkout flows" as a case for pinning document navigations with the `__vdpl` cookie ([docs](https://vercel.com/docs/skew-protection)). The prebuilt-deploy flow has caveats on this page, so keep deploys on Vercel's own build. Add a release rule (proposed): no production promotion in the three hours after a newsletter send (PRD-70).

### G13. Feature flags and operational switches

Fowler separates release, experiment, ops, and permission toggles by lifetime and who changes them ([article](https://martinfowler.com/articles/feature-toggles.html)). Ramble has all four.

| Kind | Ramble examples | Owner | Lives | Where |
|---|---|---|---|---|
| Release | New checkout layout, new search | Engineer | Days to 2 weeks | Vercel Flags |
| Experiment | A-02 newsletter-to-booking test | Growth | Weeks | Vercel Flags split; exposure rows in the first-party `events` table; SQL analysis |
| Ops | Gift sales off, Express Checkout off, global booking pause, hold limits (PRD-17 values are proposed) | Ops or build partner | Long | Settings table and in-app admin, audit row, `revalidateTag` |
| Permission | Host staff access (PRD-48) | n/a | Permanent | Roles (ADR 0002), not flags |

| Provider option | Free tier and price | Fit | Risk |
|---|---|---|---|
| Vercel Flags via Flags SDK | Hobby 10,000 flag requests, 100 flags; Pro $0.03 per 1,000 requests ([limits](https://vercel.com/docs/flags/vercel-flags/limits-and-pricing)). Illustration: 300,000 requests a month is $9 | GA; targeting, segments, progressive rollouts; definitions bundled at build as a fallback if the service is unreachable ([quickstart](https://vercel.com/docs/flags/vercel-flags/quickstart)); OpenFeature provider included; Flags SDK is MIT ([repo](https://github.com/vercel/flags)) | Behavior past the Hobby cap UNCONFIRMED; editing needs a Vercel dashboard seat |
| PostHog | First 1M flag requests a month free ([docs](https://posthog.com/docs/feature-flags/start-here)); $0.0001 per request for 1 to 2M, as reported by search results from its experiments page, UNCONFIRMED | Experiments and funnels in one tool; Node local evaluation avoids a request per check (polls every 30 s; billed as 10 requests when definitions change, 1 when not, [docs](https://posthog.com/docs/feature-flags/local-evaluation)) | ADR 0007 declines a third-party analytics script and PostHog brings profiles and consent questions; its pricing page returned no figures to me |
| GrowthBook | Starter free (3 users, 1 project); Pro $40 per seat; self-hosted open source ([pricing](https://www.growthbook.io/pricing)) | Statistics engine; reads experiment data straight from Postgres ([docs](https://docs.growthbook.io/warehouses/postgres)), which matches the events table | Another service to run or pay for; heavy for a six-person team |
| Env variables | Free | Zero dependencies | A change needs a new deployment ([KB](https://vercel.com/kb/guide/set-up-a-staging-environment-on-vercel)), so it is not a kill switch |
| Global Config (formerly Edge Config) | Hobby: 1 store, 100,000 reads, 100 writes; writes take up to 10 seconds to propagate ([limits](https://vercel.com/docs/global-config/global-config-limits)) | Fast reads | A key-value store, not a flag product |

**Pick:** Vercel Flags for release flags and experiments; in-app settings for ops switches; GrowthBook only if the growth lead wants stronger experiment statistics later. Both sit behind one `flags` wrapper with OpenFeature-shaped types, which keeps exit cost low (ARCH-8).
**Cache Components caution.** A flag read inside a cached shell multiplies page variants. The precompute pattern warns that many flags or many values cause exponential growth in permutations ([source](https://flags-sdk.dev/concepts/precompute)). Keep release flags to dynamic parts (checkout, Suspense holes, Server Actions) or precompute one or two. The pages I read do not mention Cache Components, so this is an inference to test.
**Hygiene.** Each flag gets an owner and an expiry date; an expired release flag fails a lint (Fowler's advice, same source). CI, k6, and Lighthouse use the static provider so they do not spend the Hobby request cap.
**Demo:** Vercel Flags on Hobby for two or three release flags, static provider in automation, settings table for ops switches.

## Proposed ADR changes

| # | Change | What it would say |
|---|---|---|
| 1 | New ADR 0011, "Observability and operations" | Logger and telemetry wrappers; Pro plus Observability Plus at launch; direct OTLP in the demo; `@vercel/otel` with Sentry in custom-OTel mode; heartbeat per cron job and reconciliation-style handlers; the SLI job; one paging tool; status page on separate infrastructure; the PRD-71 SLI, exclusions, 43.2-minute budget, and policy; ten runbooks and one rehearsal; severity matrix. |
| 2 | New ADR 0012, "Environments, migrations, and release" | The four-environment table and seed policy; Neon branch policy (Neon-managed integration, 7-day expiry, slot budget); CI migration job and compatibility rule; staged production plus printed promote command; rollback and undo; Skew Protection on Pro; no promotion in the three hours after a send. |
| 3 | New ADR 0013, "Feature flags and operational switches" | Four toggle kinds; Vercel Flags behind a `flags` wrapper for release and experiment flags; ops switches in the in-app settings table with audit; static provider in automation; flag owner and expiry rule. |
| 4 | Amend ADR 0007, monitoring bullet | Replace "synthetic test booking from GitHub Actions or a monitoring service" with the guarded-route probe and the reasons (5-minute minimum, delays, private-repo minutes, live-mode cards). Add: Hobby cron limits already noted; add Hobby limits for deployments per day and concurrent builds; list the Pro features the real job depends on (Observability Plus, alerts, drains, custom environment, Skew Protection, Rolling Releases). |
| 5 | Amend ADR 0002 (item 13 and demo notes) | Name the branch mechanism and expiry; state that the primary branch counts toward the Free cap (once confirmed); require the direct URL for migrations; note Neon Scale as the only tier with a published 99.95% SLA. |
| 6 | Amend ADR 0006 | Add to per-PR gates: migration drift check and `drizzle-kit check`; Lighthouse and smoke run against protected previews with a bypass; the synthetic probe is not a GitHub Actions job. |
| 7 | Amend `.claude/standards/stack-decisions.md`, row "Analytics, monitoring, and feature-flag vendors" | Change "no feature-flag vendor" to Vercel Flags behind a wrapper plus in-app ops switches; add the logger, telemetry, heartbeat, and status vendors with their wrappers; keep PostHog as the named alternative. |
| 8 | PRD delta, not an edit | PRD is signed. Log in `docs/plan/delta-log.md` after freeze: PRD-71 gets a written SLI, exclusions, and dependency note; add Q-23: "Who is first responder after hours, with what response times, inside the $8k retainer?" and Q-24: "Who may flip ops switches (gift sales, Express Checkout, booking pause)?" |

## Not confirmed

| Item | Why |
|---|---|
| Vercel Flags behavior after the Hobby cap of 10,000 requests | Limits page states the cap, not the failure mode |
| Better Stack: phone alerts on which plan; custom domain on the free status page | Pages list features without plan mapping |
| Grafana Cloud free synthetic monitoring terms; IRM free versus paid | Pricing page and IRM docs disagree |
| Axiom Personal terms for commercial use | Not on the pricing page |
| `@vercel/otel` and `@sentry/nextjs` with Next.js 16.4 Cache Components | Neither page states support |
| Whether Neon's primary branch counts toward the Free cap of 10 | Plans page silent |
| Neon-managed integration plus an Actions-created branch of the same name | Each documented alone |
| Protection Bypass for Automation on Hobby | Deployment Protection page does not map it to plans |
| Per-job minute rounding on GitHub Actions; required reviewers on private repos on GitHub Free | Not on the pages read |
| PostHog overage figures | Pricing page is script-rendered and returned no numbers; overage rate comes from a search summary of its experiments page |
| Observability Plus bill at Ramble's traffic | Events include static asset requests; measure on staging during the k6 run |
| Neon SLA plan mapping (Scale only versus Scale and Business) | Read from search summaries of the SLA and plans pages, not fetched directly; the 99.95% figure and "compute endpoint availability only" scope come from the same summaries |

## Sources

All pages read 2026-10-18. "Page date" is the date the vendor printed, where one was visible.

| Topic | URL | Page date |
|---|---|---|
| Vercel limits | https://vercel.com/docs/limits | 2026-09-16 |
| Vercel runtime logs | https://vercel.com/docs/logs/runtime | 2026-08-28 |
| Vercel drains | https://vercel.com/docs/drains | 2026-09-01 |
| Observability Plus | https://vercel.com/docs/observability/observability-plus | 2026-07-06 |
| Vercel Observability | https://vercel.com/docs/observability | 2026-09-10 |
| Vercel alerts | https://vercel.com/docs/alerts | 2026-09-09 |
| Vercel tracing | https://vercel.com/docs/tracing | 2026-09-16 |
| Always-on tracing | https://vercel.com/docs/tracing/always-on-tracing | 2026-08-24 |
| Cron usage and pricing | https://vercel.com/docs/cron-jobs/usage-and-pricing | 2026-07-15 |
| Managing cron jobs | https://vercel.com/docs/cron-jobs/manage-cron-jobs | 2026-08-11 |
| Instant Rollback | https://vercel.com/docs/instant-rollback | 2026-07-07 |
| Environments | https://vercel.com/docs/deployments/environments | 2026-09-17 |
| Staging KB | https://vercel.com/kb/guide/set-up-a-staging-environment-on-vercel | none |
| Promoting deployments | https://vercel.com/docs/deployments/promoting-a-deployment | 2026-06-26 |
| Rolling Releases | https://vercel.com/docs/rolling-releases | 2026-09-15 |
| Skew Protection | https://vercel.com/docs/skew-protection | 2026-09-16 |
| Deployment retention | https://vercel.com/docs/deployment-retention | 2026-09-16 |
| Deployment Protection | https://vercel.com/docs/deployment-protection | 2026-09-15 |
| Vercel pricing | https://vercel.com/pricing | none |
| Vercel SLA | https://vercel.com/legal/sla | none |
| Speed Insights pricing | https://vercel.com/docs/speed-insights/limits-and-pricing | 2026-09-23 |
| Vercel Flags overview | https://vercel.com/docs/flags | 2026-09-15 |
| Vercel Flags limits and pricing | https://vercel.com/docs/flags/vercel-flags/limits-and-pricing | 2026-08-26 |
| Vercel Flags quickstart | https://vercel.com/docs/flags/vercel-flags/quickstart | 2026-08-11 |
| Vercel Flags GA post | https://community.vercel.com/t/vercel-flags-is-now-generally-available/38589 | 2026-04-17 |
| Global Config limits | https://vercel.com/docs/global-config/global-config-limits | 2026-07-29 |
| Flags SDK precompute | https://flags-sdk.dev/concepts/precompute | none |
| Flags SDK repo | https://github.com/vercel/flags | none |
| Next.js OpenTelemetry | https://nextjs.org/docs/app/guides/open-telemetry | 2026-08-06 |
| Next.js instrumentation | https://nextjs.org/docs/app/guides/instrumentation | 2026-08-06 |
| Next.js `after` | https://nextjs.org/docs/app/api-reference/functions/after | 2026-09-16 |
| Next.js data security | https://nextjs.org/docs/app/guides/data-security | 2026-10-06 |
| Neon plans | https://neon.com/docs/introduction/plans | none |
| Neon pricing | https://neon.com/pricing | none |
| Neon branching | https://neon.com/docs/introduction/branching | none |
| Neon Vercel-managed integration | https://neon.com/docs/guides/vercel-managed-integration | none |
| Neon Neon-managed integration | https://neon.com/docs/guides/neon-managed-vercel-integration | none |
| Neon create-branch action | https://github.com/neondatabase/create-branch-action | none |
| Neon GitHub Actions guide | https://neon.com/docs/guides/branching-github-actions | none |
| Neon data anonymization | https://neon.com/docs/workflows/data-anonymization | none |
| Neon connection pooling | https://neon.com/docs/connect/connection-pooling | none |
| Neon SLA | https://neon.com/neon-business-sla | 2026-02-20 (per search result) |
| Drizzle migrations | https://orm.drizzle.team/docs/migrations | none |
| Drizzle kit check | https://orm.drizzle.team/docs/drizzle-kit-check | none |
| Drizzle seed | https://orm.drizzle.team/docs/seed-overview | none |
| Drizzle with Neon | https://orm.drizzle.team/docs/tutorials/drizzle-with-neon | none |
| Sentry pricing | https://sentry.io/pricing/ | none |
| Sentry Next.js | https://docs.sentry.io/platforms/javascript/guides/nextjs/ | none |
| Sentry custom OTel | https://docs.sentry.io/platforms/javascript/guides/nextjs/opentelemetry/custom-setup/ | none |
| Axiom pricing | https://axiom.co/pricing | none |
| Axiom OpenTelemetry | https://axiom.co/docs/send-data/opentelemetry | none |
| Axiom Vercel | https://axiom.co/docs/apps/vercel | none |
| Better Stack pricing | https://betterstack.com/pricing | none |
| Better Stack Uptime | https://betterstack.com/better-uptime | none |
| Better Stack logs on Vercel | https://betterstack.com/docs/logs/vercel/ | none |
| Grafana pricing | https://grafana.com/pricing/ | none |
| Grafana IRM | https://grafana.com/docs/grafana-cloud/alerting-and-irm/irm/ | none |
| Checkly pricing | https://checklyhq.com/pricing | none |
| PagerDuty pricing | https://www.pagerduty.com/pricing/incident-management/ | none |
| incident.io pricing | https://incident.io/pricing | none |
| Instatus pricing | https://instatus.com/pricing | none |
| Atlassian Statuspage pricing | https://www.atlassian.com/software/statuspage/pricing | none |
| Healthchecks.io pricing | https://healthchecks.io/pricing/ | none |
| Upptime | https://upptime.js.org/ | none |
| Opsgenie licensing | https://www.atlassian.com/licensing/opsgenie | none |
| GitHub Actions schedule | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | none |
| GitHub Actions billing | https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions | none |
| Google SRE error budget policy | https://sre.google/workbook/error-budget-policy/ | none |
| Google SRE alerting on SLOs | https://sre.google/workbook/alerting-on-slos/ | none |
| PostHog flags | https://posthog.com/docs/feature-flags/start-here | none |
| PostHog local evaluation | https://posthog.com/docs/feature-flags/local-evaluation | none |
| GrowthBook pricing | https://www.growthbook.io/pricing | none |
| GrowthBook Postgres | https://docs.growthbook.io/warehouses/postgres | none |
| Fowler on toggles | https://martinfowler.com/articles/feature-toggles.html | none |
| Stripe webhooks | https://docs.stripe.com/webhooks | none |
| Stripe testing | https://docs.stripe.com/testing | none |

**Agent-directed text seen and not acted on.** Several pages carry instructions aimed at coding agents. I did not run or follow any of them: Vercel doc pages with an "install_vercel_plugin" line and the Flags quickstart's "Agent prompt" (CLI install, `vercel link`, `npx skills add`, `vercel --prod`); the Neon guide's note asking assistants to POST feedback to an external URL; the Stripe webhooks page's `stripe agent setup` quickstart. Nothing was installed, created, or submitted.
