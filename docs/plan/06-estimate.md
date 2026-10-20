---
artifact: 6 (three-point estimate, reference-class cross-check)
status: for the plan freeze, 2026-10-20 (Dave adopted the recommendations; DECISIONS 2026-10-20)
record: docs/plan/units.yaml (estimate_days); docs/plan/estimate-panel.json (every lens's figures, the solo estimates)
scripts: scripts/plan/critical-path.ts --weight pert; scripts/plan/forecast.ts --report estimate
---

# Ramble: estimate

## Headline

All figures are ranges, P10 to P90, with P50 in the middle. The demo scope is P5, Foundation and Must: 116 units, with U-118 (the merge desk, added 2026-10-20 after the panel; PM estimate 1.5 / 3 / 7 days).

- **Work.** 228 to 299 days as routed, 259 at P50. A solo engineer without coding agents would need 355 to 463 days.
- **The floor.** With every owner full time and nobody waiting, the build takes 6.4 to 8.8 weeks (7.5 at P50). From a 2026-10-26 start, that is 2026-12-14 to 2027-01-05. No staffing beats this floor.
- **December 1 is out of reach.** The client's date (PRD Q-07) falls inside the floor in 0 of 2,000 runs. That holds whatever the staffing.
- **The path in days** is 32.1 ± 2.4 days over 12 units. It runs U-118 → U-001 → U-003 → U-011 → U-012 → U-014a → U-048 → U-049 → U-064a → U-065a → U-065b → U-104: the merge desk, the money core, then gift redemption and exchange, then the launch review. U-118 added 3.4 days to the path (28.7 before it). Seven units sit within half a day of it.
- **The Prototype milestone** (DECISIONS 2026-10-20; 21 units, listed in `07-resourcing.md`) has a floor of 2.8 to 4.0 weeks on the same terms.
- **What sets the date is Dave's hours, not the graph.** At 10 to 15 h a week the full build lands between February and August 2027 (P50 to P90 across the scenarios), depending on the merge rule and the levers. That is artifact 7 (`07-resourcing.md`). Under the plan (tiered auto-merge with levers 2, 3, and 4a, decided 2026-10-20), the Prototype lands about 2026-11-30 (P90 12-07) and the full build about 2027-03-08 (P90 2027-03-26).

The reference classes agree with the range; see the cross-check below. One assumption carries more weight than any unit: how much of Dave's time an agent-built unit costs. If he reads and merges every unit, it is about 1.1 h at the gate. Under tiered auto-merge it is an escalation now and then, plus a batch read for the critical tier. Either way, P5 calibrates it after the first three merges.

## What a day means

One estimate-day is 6 focused hours of the owner's time on the unit, from branch cut to merge-ready: CI green, review verdict addressed, fix rounds done.

- **Fan-out units:** the day is the pipeline's elapsed time. That covers the agent build, the reviews, the fix rounds, CI reruns, and a rebase.
- **Human-led units:** the day is the unit's length while Dave works on it full time, with agents carrying pieces.
- **Not in the day:** the wait for Dave's merge and Dave's part-time hours. Artifact 7 applies both.

P5 compares `actual_days` (git, first commit to merge) against this figure. Each unit also records `dave_minutes`. For a human-led unit, the comparison converts actual elapsed days by Dave's logged hours.

## How the estimates were made

- **A blind panel of four**, each estimating all 132 open units from the record, the scores, the design doc, and the spike notes. Each lens worked alone, from a different angle:
  - bottom-up, from the tasks each scope implies;
  - analogy, scaled from a prior client's checkout epic and from industry norms;
  - pipeline, from where agent elapsed time really goes;
  - risk-first, setting the tails from failure modes.
- **Two estimates per unit:** one as routed, and one solo (one engineer with no coding agents) for the resourcing baseline. Each estimate has three points; o and p are about the 1-in-10 good and bad cases.
- **Aggregation.** Each final point is the median of the four lenses. Where the lenses' likely values were 2x apart or more, a moderator settled the unit on the merits. That happened for three units: U-001 (the first CI run is slower than a scaffold), U-058 (four New York time-boundary cases), and U-094b (agents add nothing).
- **One fix to the request.** The panel's unit list said U-076, but the record splits it into U-076a, U-076b, and U-076c. The bottom-up lens estimated the parts. The other three lenses' combined figures were apportioned by that split.
- **The same caveat as artifact 3.** One model family with four briefs shares its priors. Only three units diverged 2x, which overstates how independent the panel was. Three of the four lenses said the same thing without being asked: the per-unit sums miss the rework at the seams. Their examples were `confirmOrder`'s typed stubs, the refund contract, the gift branches, the axe matrix rows, and fixes the launch units surface. That shared error is why the forecast carries a systemic factor (below) instead of padding units.
- **The P4 spikes** (U-013, U-028) are done, so they carry no estimate.

## The spread: where the range comes from

**Widest units** (o / m / p days, as routed):

| Unit | Why it is wide |
|---|---|
| U-046 Stripe Connect adapter, 3 / 6 / 15 | Real job only, never run here; Connect onboarding, fee timing, webhook ordering |
| U-096 Load test, 2 / 4 / 12 | Real traffic shape unknown; results may send fixes back into the hold path |
| U-065a Gift exchange: confirm branch, 1.75 / 3 / 8 | The most branched confirm path, on the critical path |
| U-047a startPayment, U-049 confirmOrder, 2 / 4 / 8 each | Pattern-setting money code; race tests against real Postgres |
| U-052 Payment race and idempotency tests, 1.5 / 3 / 7 | Flaky real-database tests in CI |
| U-004b Passkeys and step-up, 1 / 2.25 / 6 | Per-role sign-in limits and step-up are not stock Better Auth |
| U-093 Redirect map, U-101 Device matrix, 1 / 2 / 6 each | Uncertainty 3: the old site, real phones and wallets |

**Most critical** (share of runs on the longest chain): U-118, U-001, U-003, U-011, and U-104 in every run; U-014a 85%, U-048 77%, U-049 76%, U-012 64%. The gifting chain and the load test come next, at about 30%. The money core is critical under any weighting, as artifact 4 found in points.

**Changed from artifact 4.** In points, four routes tied at 26 (28 with U-118 at the root). In days, the gift chain (U-064a, U-065a, U-065b) wins by half a day. The confirmation and failure screens, manage booking, the synthetic booking, and the load test sit 0.5 days behind it.

**By section** (sum of means, days): ops 40.0, checkout 30.3, launch 28.8, data 27.1, platform 25.9 (22.5 before U-118), gifting 21.1, post-booking 13.3, design system 11.1, catalog 9.8, host 7.1, experience 6.6, measurement 5.3, SEO 5.0.

## Reference-class cross-check

The method's rule: three-point on the path, reference class as the check. The research behind this table read the vault notes on that checkout epic and the git history of Dave's agent-built repos.

| Reference class | Team and hours | Throughput | Applied to 116 Ramble units | What the model says |
|---|---|---|---|---|
| Prior client checkout epic (2026-05-27 to 08-10) | Dave, full time, worktree agents; front end only (the backend owned cart, holds, money) | 10.5 merged PRs a week | about 11 weeks | One engineer full time with agents, merging everything: 12.7 to 16.6 weeks (artifact 7). About 20% slower, which fits: Ramble's units include the backend and money paths. |
| robo-advisor (2026-02 to 04) | Dave plus agents, side-project hours; full stack, no money movement | 8.6 PRs a week sustained (23 in the burst) | about 13 weeks | The plan at 10 to 15 h: 15.2 to 21.6 weeks at P50. Dave merging everything before the levers: 28.4 at 12.5 h. |
| Harp-Diem (2026-01 to 03) | Dave plus agents, side-project hours; static site | 3.5 PRs a week sustained | about 33 weeks | Same band |
| Prior client discovery surface | Dave full time, planned up front | Finished about a week early | | Planned work can land early; sets the systemic factor's low end |

**What the check says:**

- **Throughput agrees.** One person part time with agents sustained 3.5 to 8.6 PRs a week. Applied to Ramble's 116 units, that is 13 to 33 weeks. The model's Dave scenarios fall in that band: the plan at 15.2 to 21.6 weeks, merging everything before the levers at 28.4. The slower rows sit near its slow end, which fits two differences:
  - Dave reads every merge, which none of the reference classes did;
  - a Ramble unit is larger than a personal-project PR.
- **The overrun sets the systemic factor.** Each run scales every unit's days and Dave's gate minutes by one factor of 0.9 / 1.1 / 1.5 (o / m / p):
  - **0.9:** the one project planned up front (Discovery) landed about a week early;
  - **1.1:** the panel puts unestimated seam work at 10 to 20%;
  - **1.5:** the unplanned checkout epic ran 36% over to launch and 43% to epic close.

  Without the factor, the floor is 6.1 to 7.3 weeks: too narrow to be honest, because 116 independent draws cancel out error the units share.
- **Dave's hours per unit look plausible.** Under the plan the model has him spending about 1.6 h per merged unit (his own units, gates, and tasks); merging everything before the levers, about 2.9 h. On the checkout he spent about 3.6 h per merged PR full time, and he wrote most of that code himself.
- **The one figure the check cannot confirm: the agents' leverage.** The model turns 404 solo days (about 2,430 h) into about 180 h of Dave's time under the plan, roughly 13x (about 340 h, or 7x, if he merges everything as first routed). The only measured figure is 3.4x, from the prior client, and that was Dave coding with AI help, the human-led style. The gap rests on fan-out units costing him about 1.1 h each at the gate. If gates cost twice that, Dave at 12.5 h a week finishes about 9 weeks later when he merges everything. Under tiered auto-merge (artifact 7), his gate time drops to about 63 h, and the risk shifts. The question becomes whether agent verdicts on the standard tier hold up without his read, which the nightly suite and the weekly promotion will show. Each extra 10 h of his time adds about 0.8 weeks at 12.5 h a week. Artifact 5's calibration after the first three fan-out merges (U-001, U-023, U-102) tests this first.

## What the range leaves out

- **Calendar effects inside Dave's week.** Spurts and other commitments. The forecast spreads his hours evenly.
- **The real job's extra scope.** That covers U-046 and the 14 Shoulds, 289 days at P50 against 259, plus email and the domain cutover. The floor does not move, because the path is the same.
- **The legacy-retirement tail.** U-094a, then U-094b. About 1.5 days of work, which starts 60 days after launch. The plan ends when the old site is removed.
- **Real-job vendor waits.** Stripe Connect review, counsel (Q-16), and the sponsor contract (Q-13).

## Calibrating in P5

- Each unit closes with `actual_days`, `dave_minutes`, and `tokens`. A unit off by more than 25% gets a line in `delta-log.md`.
- Rerun the forecast after the calibration points in artifact 5: the first three fan-out merges, the first two critical-tier merges, and the first C3 fan-out merge. A new forecast after the freeze goes in the delta log. This estimate stays as frozen.
- **The early warning:** Dave's gate hours per fan-out unit against 1.1 h.

## Generated: the critical path in days

```bash
bun scripts/plan/critical-path.ts --weight pert --brief --write docs/plan/06-estimate.md
```

<!-- critical-path:demo:start -->
#### Scope `demo`, weighted by pert

Generated by `bun scripts/plan/critical-path.ts --scope demo --brief --weight pert`. Do not edit by hand.

| Measure | Value |
|---|---|
| Units in scope | 116 |
| Dependency edges in scope | 367 |
| Critical path length | 32.1 days, 12 units |
| Finish with one Dave (his units one at a time) | 40.2 days; 32.8 if agents carry 50% of each |
| Total work | 231.4 days |
| Work ÷ path (average parallelism the graph allows) | 7.2 |
| Zero-slack units | 12 |
| Near-critical units (slack ≤ 2) | 21 |
| Path mean ± 1 sd | 32.1 ± 2.4 days (P10 to P90 about 29.1 to 35.2) |

**Checks.** No duplicate IDs, missing dependencies, cycles, Must-on-Should dependencies, or out-of-scope dependencies.
- Dependencies met in P4: U-013, U-028.
- Out of scope, P4 (done before the plan freeze; dependencies on it count as met): U-013, U-028.
- Out of scope, Should (first in the cut order; run with --should): U-033, U-034, U-042, U-043, U-044, U-057, U-061, U-107, U-072, U-110, U-081, U-082, U-083b, U-090.
- Out of scope, estimated, not built in the demo: U-046.
- Out of scope, post-launch (legacy-retirement tail, reported below): U-094a, U-094b.

**Critical path** (platform → data → checkout → gifting → launch):

| # | Unit | Title | Section | C | U | Weight | Ends at |
|---|---|---|---|---|---|---|---|
| 1 | U-118 | Merge desk and agent identity | platform | 2 | 2 | 3.4 | 3.4 |
| 2 | U-001 | Repository setup and CI gates | platform | 1 | 1 | 1.1 | 4.5 |
| 3 | U-003 | Database wiring and migrations | platform | 2 | 2 | 2.2 | 6.7 |
| 4 | U-011 | Catalog schema and read layer | data | 2 | 1 | 2.0 | 8.7 |
| 5 | U-012 | Sessions, templates, and allocations | data | 2 | 2 | 1.8 | 10.5 |
| 6 | U-014a | Holds core and reserveSpaces | data | 3 | 2 | 3.3 | 13.8 |
| 7 | U-048 | Webhook intake and the event table | checkout | 3 | 2 | 3.3 | 17.0 |
| 8 | U-049 | confirmOrder for bookings | checkout | 3 | 2 | 4.3 | 21.4 |
| 9 | U-064a | redeemGift and the redemption confirm | gifting | 3 | 2 | 2.8 | 24.2 |
| 10 | U-065a | Gift exchange: confirm branch | gifting | 3 | 2 | 3.6 | 27.8 |
| 11 | U-065b | Gift exchange: page and top-up | gifting | 2 | 2 | 2.2 | 30.0 |
| 12 | U-104 | Launch readiness review | launch | 2 | 2 | 2.2 | 32.1 |

**Near-critical** (slack ≤ 2 days; a slip here joins the path):

| Unit | Title | Section | Slack |
|---|---|---|---|
| U-050 | Confirmation page and order status | checkout | 0.5 |
| U-051 | Checkout failure states | checkout | 0.5 |
| U-096 | Load test | launch | 0.5 |
| U-018 | Editorial and policy schema | data | 0.5 |
| U-055 | Manage booking and cancelBooking | post-booking | 0.5 |
| U-097 | Uptime, heartbeats, SLO, synthetic booking | launch | 0.5 |
| U-114 | Synthetic booking isolation | launch | 0.5 |
| U-111 | Pricing and cancellation windows | data | 0.7 |
| U-099 | Runbooks and rehearsal | launch | 1.1 |
| U-103 | Staged releases and freeze rule | launch | 1.1 |
| U-105 | Booking-path smoke and nightly suite | launch | 1.1 |
| U-115 | Launch cutover runbook and rehearsal | launch | 1.1 |
| U-015 | Orders, attempts, events, refunds, transfers schema | data | 1.5 |
| U-019 | Guests, consents, and privacy | data | 1.5 |
| U-016 | Ledger and its views | data | 1.6 |
| U-116 | Caller and role contract | platform | 1.6 |
| U-056 | Refund processing | post-booking | 1.6 |
| U-064b | Gift redemption page | gifting | 1.8 |
| U-059 | Session cancellation fan-out | post-booking | 1.9 |
| U-086 | Events table and beacons | measurement | 1.9 |
| U-100 | Accessibility pass | launch | 1.9 |

<!-- critical-path:demo:end -->

## Generated: the forecast

```bash
bun scripts/plan/forecast.ts --report estimate --write docs/plan/06-estimate.md
bun scripts/plan/forecast.ts --report estimate --scope real-job --should --write docs/plan/06-estimate.md
```

### Demo scope

<!-- forecast:estimate:start -->
Generated by `bun scripts/plan/forecast.ts --report estimate --runs 2000 --seed 6 --start 2026-10-26`. Do not edit by hand. Working days skip weekends and 2026-11-26, 2026-11-27, 2026-12-24, 2026-12-25, 2026-12-31, 2027-01-01. Systemic factor per run: 0.9 / 1.1 / 1.5.

| Measure (116 units in scope `demo`) | P10 | P50 | P90 |
|---|---|---|---|
| Total work as routed, days | 227.7 | 259.1 | 299.3 |
| Total work solo (one engineer, no agents), days | 355.0 | 403.7 | 462.7 |
| Graph finish, every owner full time and free, working days | 32.2 | 37.6 | 44.2 |
| The same, in weeks | 6.4 | 7.5 | 8.8 |
| The same, as a date from 2026-10-26 | 2026-12-14 | 2026-12-21 | 2027-01-05 |
| The Prototype (21 units) on the same terms, weeks | 2.8 | 3.3 | 4.0 |

Sum of the three-point means: 231.4 days as routed, of which the 9 human-led units carry 29.4 and the 107 fan-out units 202.0. The single PERT path (critical-path.ts) is 32.1 days of means; the simulated P50 is later for two reasons. The graph has many near-tied chains, and the latest of several uncertain chains runs later than any one of them (merge bias). And each run scales every unit by the systemic factor, error the units share that a sum of independent units hides. 2000 runs. Chance the floor alone makes 2026-12-01 (24 working days): 0%.

**Criticality** (share of runs in which the unit is on the longest chain; units at 10% or more):

| Unit | Title | Route | o / m / p days | Critical in |
|---|---|---|---|---|
| U-001 | Repository setup and CI gates | agent-fan-out | 0.5 / 1 / 2 | 100% |
| U-104 | Launch readiness review | human-led | 1 / 2 / 4 | 100% |
| U-118 | Merge desk and agent identity | human-led | 1.5 / 3 / 7 | 100% |
| U-003 | Database wiring and migrations | agent-fan-out | 1 / 2 / 4 | 100% |
| U-011 | Catalog schema and read layer | agent-fan-out | 1 / 2 / 3 | 100% |
| U-014a | Holds core and reserveSpaces | human-led | 1.75 / 3 / 6 | 85% |
| U-048 | Webhook intake and the event table | human-led | 1.5 / 3 / 6 | 77% |
| U-049 | confirmOrder for bookings | human-led | 2 / 4 / 8 | 76% |
| U-012 | Sessions, templates, and allocations | agent-fan-out | 0.88 / 1.5 / 4 | 64% |
| U-065b | Gift exchange: page and top-up | agent-fan-out | 1 / 2 / 4 | 34% |
| U-064a | redeemGift and the redemption confirm | agent-fan-out | 1.5 / 2.5 / 5.5 | 33% |
| U-065a | Gift exchange: confirm branch | agent-fan-out | 1.75 / 3 / 8 | 33% |
| U-096 | Load test | agent-fan-out | 2 / 4 / 12 | 29% |
| U-050 | Confirmation page and order status | agent-fan-out | 0.88 / 1.5 / 2.75 | 27% |
| U-051 | Checkout failure states | agent-fan-out | 0.75 / 1.5 / 2.5 | 26% |
| U-055 | Manage booking and cancelBooking | agent-fan-out | 1.5 / 3 / 6 | 20% |
| U-097 | Uptime, heartbeats, SLO, synthetic booking | agent-fan-out | 1 / 1.75 / 4 | 20% |
| U-114 | Synthetic booking isolation | agent-fan-out | 1.5 / 2.5 / 5.5 | 20% |
| U-018 | Editorial and policy schema | agent-fan-out | 0.75 / 1.25 / 2.25 | 18% |
| U-015 | Orders, attempts, events, refunds, transfers schema | agent-fan-out | 1 / 2 / 3 | 15% |
| U-019 | Guests, consents, and privacy | agent-fan-out | 0.75 / 1.5 / 3 | 15% |
| U-105 | Booking-path smoke and nightly suite | agent-fan-out | 1 / 1.75 / 4.5 | 13% |
| U-056 | Refund processing | agent-fan-out | 1.5 / 3 / 6 | 12% |
| U-047a | startPayment action | human-led | 2 / 4 / 8 | 11% |
| U-016 | Ledger and its views | human-led | 1.75 / 3 / 5 | 11% |
| U-047b | Checkout page | agent-fan-out | 1.75 / 3 / 6 | 10% |
<!-- forecast:estimate:end -->

### Real job, with the Shoulds

<!-- forecast:estimate-real-job+should:start -->
Generated by `bun scripts/plan/forecast.ts --report estimate --scope real-job --should --runs 2000 --seed 6 --start 2026-10-26`. Do not edit by hand. Working days skip weekends and 2026-11-26, 2026-11-27, 2026-12-24, 2026-12-25, 2026-12-31, 2027-01-01. Systemic factor per run: 0.9 / 1.1 / 1.5.

| Measure (131 units in scope `real-job+should`) | P10 | P50 | P90 |
|---|---|---|---|
| Total work as routed, days | 251.0 | 288.6 | 330.1 |
| Total work solo (one engineer, no agents), days | 388.6 | 445.4 | 509.2 |
| Graph finish, every owner full time and free, working days | 32.3 | 37.8 | 44.0 |
| The same, in weeks | 6.5 | 7.6 | 8.8 |
| The same, as a date from 2026-10-26 | 2026-12-14 | 2026-12-21 | 2027-01-05 |
| The Prototype (21 units) on the same terms, weeks | 2.8 | 3.4 | 4.0 |

Sum of the three-point means: 255.6 days as routed, of which the 10 human-led units carry 36.4 and the 121 fan-out units 219.2. The single PERT path (critical-path.ts) is 32.1 days of means; the simulated P50 is later for two reasons. The graph has many near-tied chains, and the latest of several uncertain chains runs later than any one of them (merge bias). And each run scales every unit by the systemic factor, error the units share that a sum of independent units hides. 2000 runs. Chance the floor alone makes 2026-12-01 (24 working days): 0%.

**Criticality** (share of runs in which the unit is on the longest chain; units at 10% or more):

| Unit | Title | Route | o / m / p days | Critical in |
|---|---|---|---|---|
| U-001 | Repository setup and CI gates | agent-fan-out | 0.5 / 1 / 2 | 100% |
| U-104 | Launch readiness review | human-led | 1 / 2 / 4 | 100% |
| U-118 | Merge desk and agent identity | human-led | 1.5 / 3 / 7 | 100% |
| U-003 | Database wiring and migrations | agent-fan-out | 1 / 2 / 4 | 100% |
| U-011 | Catalog schema and read layer | agent-fan-out | 1 / 2 / 3 | 98% |
| U-014a | Holds core and reserveSpaces | human-led | 1.75 / 3 / 6 | 83% |
| U-048 | Webhook intake and the event table | human-led | 1.5 / 3 / 6 | 75% |
| U-049 | confirmOrder for bookings | human-led | 2 / 4 / 8 | 74% |
| U-012 | Sessions, templates, and allocations | agent-fan-out | 0.88 / 1.5 / 4 | 63% |
| U-065b | Gift exchange: page and top-up | agent-fan-out | 1 / 2 / 4 | 33% |
| U-064a | redeemGift and the redemption confirm | agent-fan-out | 1.5 / 2.5 / 5.5 | 33% |
| U-065a | Gift exchange: confirm branch | agent-fan-out | 1.75 / 3 / 8 | 33% |
| U-096 | Load test | agent-fan-out | 2 / 4 / 12 | 31% |
| U-050 | Confirmation page and order status | agent-fan-out | 0.88 / 1.5 / 2.75 | 29% |
| U-051 | Checkout failure states | agent-fan-out | 0.75 / 1.5 / 2.5 | 29% |
| U-055 | Manage booking and cancelBooking | agent-fan-out | 1.5 / 3 / 6 | 17% |
| U-097 | Uptime, heartbeats, SLO, synthetic booking | agent-fan-out | 1 / 1.75 / 4 | 17% |
| U-114 | Synthetic booking isolation | agent-fan-out | 1.5 / 2.5 / 5.5 | 17% |
| U-018 | Editorial and policy schema | agent-fan-out | 0.75 / 1.25 / 2.25 | 16% |
| U-015 | Orders, attempts, events, refunds, transfers schema | agent-fan-out | 1 / 2 / 3 | 16% |
| U-019 | Guests, consents, and privacy | agent-fan-out | 0.75 / 1.5 / 3 | 16% |
| U-105 | Booking-path smoke and nightly suite | agent-fan-out | 1 / 1.75 / 4.5 | 12% |
| U-016 | Ledger and its views | human-led | 1.75 / 3 / 5 | 12% |
| U-056 | Refund processing | agent-fan-out | 1.5 / 3 / 6 | 12% |
| U-047a | startPayment action | human-led | 2 / 4 / 8 | 11% |
| U-047b | Checkout page | agent-fan-out | 1.75 / 3 / 6 | 10% |
<!-- forecast:estimate-real-job+should:end -->
