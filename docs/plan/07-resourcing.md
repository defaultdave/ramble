---
artifact: 7 (resourcing options)
status: decided 2026-10-20 (Dave adopted the recommendations; DECISIONS 2026-10-20); for the plan freeze
record: docs/plan/units.yaml (estimate_days, execution, review); docs/plan/estimate-panel.json (solo days)
script: scripts/plan/forecast.ts --report resourcing (Dave's minutes from scripts/plan/dave-time.ts)
---

# Ramble: resourcing

## The plan

**Tiered auto-merge, the Prototype first, and levers 2, 3, and 4a,** at 12.5 h a week of Dave's time. The record carries all of it: `units.yaml` routes the units, and `graph.ts` holds Dave's share. Weeks run from a 2026-10-26 start; ranges are P10 to P90.

| Milestone | Weeks | Likely (P50) | Late case (P90) |
|---|---|---|---|
| Prototype | 3.9 to 5.5 | 2026-11-30 | 2026-12-07 |
| Launch-ready (full build) | 15.3 to 20.6 | 2027-03-08 | 2027-03-26 |

- **Dave's load.** He owes about 180 h and uses 10.2 of his 12.5 h a week. Across his budget, launch-ready runs from 2027-02-17 at 15 h to 2027-04-02 at 10 h; the Prototype lands Nov 25 to Dec 2.
- **What he builds:** 9 of the 116 demo units. U-118 (the merge desk, first) and the money core (U-014a holds, U-016 ledger, U-047a startPayment, U-048 webhook intake, U-049 `confirmOrder`). Then the three that need his hands or call: U-100 screen-reader walk, U-101 real phones, U-104 the go or no-go. Agents carry half of each.
- **What agents build:** the other 107.
  - Six pattern-setters (U-002, U-003, U-116, U-011, U-005, U-024) carry Dave's pattern note in their scope manifests and sit on the critical tier, so he reads them in the weekly batch.
  - The redirect map and the load test (U-093, U-096) are built against fixtures, and Dave reads the results (45 minutes each, a people check in the record).
- **How merges work.** Standard-tier units merge to `main` when every agent check passes. Critical-tier units merge to `integration`, and Dave promotes it to `main` weekly after the nightly smoke. Setup: `merge-desk-runbook.md`.
- **December 1 (Q-07), working assumption:** the client sees the Prototype in early December and moves launch to the range above. No staffing reaches December 1 for the full build: even unlimited people finish no earlier than 2026-12-14 (`06-estimate.md`).

## What the decisions bought

The same 12.5 h a week, likely dates:

| Plan | Prototype | Launch-ready |
|---|---|---|
| Dave reads and merges everything, as first routed (artifact 5) | 2027-01-26 | 2027-05-20 |
| Tiered auto-merge alone | 2026-12-21 | 2027-04-26 |
| **Tiered plus levers 2, 3, 4a (the plan)** | **2026-11-30** | **2027-03-08** |
| Lever 4 too: agents also build the money core (not adopted) | 2026-11-30 | 2027-02-05 |

- **Tiered merge alone was worth about 4 weeks.** Dave's own units, about 214 h, were the bigger load, and tiered merge leaves them where they are. The levers took them to about 99 h.
- **Lever 4 would buy about 4 more weeks,** by handing the money core to agents. It was not adopted. That is the code that can oversell or double-charge, and under tiered merge it would be agent-written and agent-reviewed until the weekly batch. ADR 0010 names that as the known weakness.

## The Prototype milestone

**What it is.** A clickable guest flow on seed data:

- home, browse, and the experience page;
- the booking bar, order summary, and booking panel, shown with fixture data on the walking skeleton's checkout and confirmation placeholders;
- seeded sessions as stand-in availability;
- deployed to a Vercel preview.

It has no holds, payments, ledger, or sign-in.

**The 21 units,** chosen so that nothing they depend on is outside the set (the script checks this):

| Area | Units |
|---|---|
| Platform | U-118 merge desk, U-001 repo and CI, U-002 walking skeleton and preview deploy, U-003 database, U-116 caller contract, U-009 cache conventions, U-117 rich-text renderer |
| Data | U-011 catalog schema, U-012 sessions (the stand-in availability), U-111 pricing (prices on cards and the order summary), U-018 editorial schema (home modules), U-010 photo storage, U-021a seed script |
| Design system | U-023 tokens, U-024 and U-025 primitives, U-026 date picker and sheet, U-027 order summary, booking bar, booking panel |
| Pages | U-030 home, U-031 browse, U-039 experience page |

**Left out on purpose:**

- U-041, the working booking bar, which calls `reserveSpaces`;
- U-040, live spaces left;
- U-047b, the checkout page;
- U-050, the confirmation page.

Each of those needs holds or payments. The stubs are the walking skeleton's placeholder routes, filled with U-027's components and fixture data. That glue is under half a day. It has no unit of its own, so it is the one piece of work outside `units.yaml`.

**Optional add:** U-021b, curated content and the photo pool (about 2.75 days, plus 3.5 h of Dave's content sign-off). Without it, the Prototype shows generated seed copy and placeholder photos.

**Its floor.** With every owner full time and free, the Prototype takes 2.8 to 4.0 weeks. The plan lands it at 3.9 to 5.5. Most of the gap is U-118, which only Dave can build and which comes first.

**Order barely matters now.** Taking the Prototype units first moves it from Dec 1 to Nov 30. Before the levers it was worth three weeks, because Dave's own Prototype units held it up. Agents now build those.

## Dave's week

At 12.5 h a week, he uses about 10.2 h:

| Work | Hours over the build (P50) | A week, on average |
|---|---|---|
| His units: U-118, U-014a, U-016, U-047a, U-048, U-049, U-100, U-101, U-104, half of each | 99 | 5.6 |
| Gates: the weekly promotion and batch reads, escalations, people checks | 68 | 3.8 |
| Account tasks and weekly work | 14 | 0.8 |
| Slack (nothing ready) | 40 | 2.3 |

- **His first week or so** goes to U-118: the GitHub App, the rulesets, the check workflows, and the dry run.
- **December and January** go to the money core, one unit after another. That chain sets launch day.
- **Gate time under tiered merge is about 68 h, not the 30 h the decision expected.** The critical-tier batch reads are about 24 h, as expected. People checks, escalations, and the weekly promotion stay with Dave.

## Sensitivity

| Change, at 12.5 h | Prototype | Launch-ready |
|---|---|---|
| None (the plan) | 2026-11-30 | 2027-03-08 |
| Work-in-progress limit of 4 open fan-out units instead of 8 | 2026-12-02 | 2027-03-12 |
| Prototype units not taken first | 2026-12-01 | 2027-03-08 |
| Dave merges everything, with the levers | 2026-12-03 | 2027-03-23 |

## The real job: one engineer or two

Lever 2 does not apply in the real job, because the old site and real traffic are outside facts. These rows keep U-093 and U-096 with the lead.

| Option | Launch-ready | P50 date | What binds |
|---|---|---|---|
| One engineer full time, no agents | 83.3 weeks (73.1 to 95.5) | 2028-06-08 | 2,450 h of building |
| One engineer with agents, merging everything | 14.4 (12.7 to 16.6) | 2027-02-11 | Their own units in series |
| One engineer with agents, tiered | 10.0 (8.6 to 11.7) | 2027-01-12 | Their own units |
| Two engineers with agents, merging everything | 8.8 (7.6 to 10.2) | 2027-01-04 | Mostly the graph (floor 7.5 weeks) |

- **Where two engineers split.** Engineer A takes the money core, the critical chain: data, holds, checkout, gifting, post-booking. Engineer B takes the merge desk, the platform setup, the design system, host and ops tools, and launch operations.
- **Tiered merge does most of what a second engineer does.** One engineer with tiered merge comes within about a week of two engineers who merge by hand.
- **The leverage behind every agent row is unconfirmed.** The checks after the first three merges and the first two promotions test it (`05-execution-model.md`, Calibration points; `06-estimate.md`).

## Generated: the scenarios

```bash
bun scripts/plan/forecast.ts --report resourcing --write docs/plan/07-resourcing.md
bun scripts/plan/forecast.ts --report resourcing --scope real-job --should --write docs/plan/07-resourcing.md
```

### Demo scope

<!-- forecast:resourcing:start -->
Generated by `bun scripts/plan/forecast.ts --report resourcing --runs 2000 --seed 6 --start 2026-10-26`. Do not edit by hand. Working days skip weekends and 2026-11-26, 2026-11-27, 2026-12-24, 2026-12-25, 2026-12-31, 2027-01-01. Systemic factor per run: 0.9 / 1.1 / 1.5.

| Scenario | Prototype, weeks (P10 / P50 / P90) | Prototype P50 / P90 date | Finish, weeks (P10 / P50 / P90) | Finish P50 / P90 date | Bound by people or WIP | Hours a week used (P50) |
|---|---|---|---|---|---|---|
| Plan, Dave 10 h | 4.3 / 5.0 / 6.0 | 2026-12-02 / 2026-12-10 | 18.6 / 21.6 / 25.1 | 2027-04-02 / 2027-04-28 | 100% | 8.5 of 10 |
| Plan, Dave 12.5 h | 3.9 / 4.6 / 5.5 | 2026-11-30 / 2026-12-07 | 15.3 / 17.7 / 20.6 | 2027-03-08 / 2027-03-26 | 100% | 10.2 of 12.5 |
| Plan, Dave 15 h | 3.7 / 4.4 / 5.2 | 2026-11-25 / 2026-12-03 | 13.1 / 15.2 / 17.7 | 2027-02-17 / 2027-03-08 | 100% | 11.8 of 15 |
| Plan, Dave 12.5 h, WIP 4 | 4.2 / 4.9 / 5.9 | 2026-12-02 / 2026-12-09 | 16.0 / 18.5 / 21.4 | 2027-03-12 / 2027-04-02 | 100% | 9.9 of 12.5 |
| Plan, Dave 12.5 h, Prototype not first | 4.2 / 4.8 / 5.7 | 2026-12-01 / 2026-12-08 | 15.3 / 17.7 / 20.6 | 2027-03-08 / 2027-03-29 | 100% | 10.2 of 12.5 |
| Tiered, before the levers, Dave 12.5 h | 6.3 / 7.5 / 9.1 | 2026-12-21 / 2027-01-06 | 21.1 / 24.7 / 28.8 | 2027-04-26 / 2027-05-25 | 100% | 12.0 of 12.5 |
| Lever 4 too (money core to agents), Dave 12.5 h | 3.9 / 4.6 / 5.5 | 2026-11-30 / 2026-12-07 | 11.8 / 13.6 / 15.7 | 2027-02-05 / 2027-02-22 | 100% | 9.0 of 12.5 |
| Dave merges all, before the levers, 12.5 h | 10.4 / 12.0 / 14.0 | 2027-01-26 / 2027-02-10 | 24.6 / 28.4 / 32.9 | 2027-05-20 / 2027-06-22 | 100% | 12.1 of 12.5 |
| Dave merges all, with the levers, 12.5 h | 4.3 / 5.1 / 6.1 | 2026-12-03 / 2026-12-10 | 17.4 / 19.9 / 23.0 | 2027-03-23 / 2027-04-14 | 100% | 11.0 of 12.5 |
| One engineer full time, no agents | 34.4 / 39.1 / 45.1 | 2027-08-04 / 2027-09-15 | 73.1 / 83.3 / 95.5 | 2028-06-08 / 2028-09-01 | 100% | 30.0 of 30 |
| One engineer full time, agents, merges all | 5.3 / 6.2 / 7.4 | 2026-12-11 / 2026-12-18 | 12.7 / 14.4 / 16.6 | 2027-02-11 / 2027-02-26 | 100% | 17.6 of 30 |
| One engineer full time, agents, tiered | 3.2 / 3.7 / 4.4 | 2026-11-20 / 2026-11-25 | 8.6 / 10.0 / 11.7 | 2027-01-12 / 2027-01-25 | 100% | 19.6 of 30 |
| Two engineers full time, agents, merge all | 3.2 / 3.7 / 4.4 | 2026-11-20 / 2026-11-30 | 7.6 / 8.8 / 10.2 | 2027-01-04 / 2027-01-14 | 65% | 14.1 of 30 |

**Where the people's hours go** (P50 of each term over the runs, total hours across everyone; idle is capacity with nothing ready):

| Scenario | Own units | Gates and people checks | Tasks and weekly work | Idle |
|---|---|---|---|---|
| Plan, Dave 10 h | 98.8 | 68.7 | 15.6 | 31.6 |
| Plan, Dave 12.5 h | 98.8 | 67.7 | 13.6 | 40.4 |
| Plan, Dave 15 h | 98.8 | 67.1 | 12.2 | 49.6 |
| Plan, Dave 12.5 h, WIP 4 | 98.8 | 69.0 | 13.8 | 48.1 |
| Plan, Dave 12.5 h, Prototype not first | 98.8 | 67.6 | 13.5 | 40.6 |
| Tiered, before the levers, Dave 12.5 h | 213.6 | 63.1 | 17.7 | 12.7 |
| Lever 4 too (money core to agents), Dave 12.5 h | 36.8 | 70.9 | 13.6 | 47.3 |
| Dave merges all, before the levers, 12.5 h | 213.6 | 107.8 | 18.9 | 12.1 |
| Dave merges all, with the levers, 12.5 h | 98.8 | 104.4 | 14.5 | 30.9 |
| One engineer full time, no agents | 2433.6 | 0.0 | 61.5 | 0.3 |
| One engineer full time, agents, merges all | 123.8 | 114.8 | 14.4 | 178.6 |
| One engineer full time, agents, tiered | 123.8 | 62.5 | 9.6 | 104.0 |
| Two engineers full time, agents, merge all | 123.8 | 114.8 | 8.8 | 278.6 |

Hours are Dave's focused hours a week; an engineer full time is 30. Tiered: auto-merge as ADR 0010 amended it on 2026-10-20, switched on when U-118 (the merge desk) merges; no fan-out unit merges before it. Standard-tier units merge to `main` on the agents' verdicts. Critical-tier units merge to `integration`, and their dependents build on them there. Dave reads their diffs in a weekly promotion batch, and the launch review waits for the last promotion. Before the switch, and in the "merges all" rows, Dave reads and merges every unit. Tiered rows take the Prototype first and allow 8 open fan-out units unless the row says otherwise. Prototype: U-118, U-001, U-002, U-003, U-116, U-011, U-012, U-111, U-009, U-117, U-018, U-010, U-021a, U-023, U-024, U-025, U-026, U-027, U-030, U-031, U-039, all on `main`. No row reaches 2026-12-01. The plan rows run the record as routed, which carries the freeze decisions: lever 2 (U-093, U-096 built by agents, with Dave's results read as a people check), lever 3 (Dave's share of each unit he leads 0.35 / 0.5 / 0.65), and lever 4a (U-002, U-003, U-116, U-011, U-005, U-024 built by agents). "Before the levers" moves those units back to Dave at his earlier share of 0.5 / 0.65 / 0.8. "Lever 4 too" also hands the money core to agents (not adopted). "With the levers" in a merges-all row adds lever 1: standard-tier units merge on a green verdict. The real-job rows keep U-093 and U-096 with the lead. A unit moved to fan-out keeps its days and gets the full gate, critical-tier read included. WIP: open fan-out units, building or at the gate. Bound: the run finishes more than 15% later than the same draws with every owner full time and free. The work-in-progress limit is 4 open fan-out units per person unless the row says otherwise. 2000 runs per scenario, the same draws in every scenario.
<!-- forecast:resourcing:end -->

### Real job, with the Shoulds and the Stripe adapter

<!-- forecast:resourcing-real-job+should:start -->
Generated by `bun scripts/plan/forecast.ts --report resourcing --scope real-job --should --runs 2000 --seed 6 --start 2026-10-26`. Do not edit by hand. Working days skip weekends and 2026-11-26, 2026-11-27, 2026-12-24, 2026-12-25, 2026-12-31, 2027-01-01. Systemic factor per run: 0.9 / 1.1 / 1.5.

| Scenario | Prototype, weeks (P10 / P50 / P90) | Prototype P50 / P90 date | Finish, weeks (P10 / P50 / P90) | Finish P50 / P90 date | Bound by people or WIP | Hours a week used (P50) |
|---|---|---|---|---|---|---|
| Plan, Dave 10 h | 4.3 / 5.0 / 6.0 | 2026-12-03 / 2026-12-09 | 20.8 / 24.2 / 28.3 | 2027-04-21 / 2027-05-20 | 100% | 8.8 of 10 |
| Plan, Dave 12.5 h | 3.9 / 4.6 / 5.5 | 2026-11-30 / 2026-12-07 | 16.9 / 19.8 / 23.1 | 2027-03-22 / 2027-04-14 | 100% | 10.6 of 12.5 |
| Plan, Dave 15 h | 3.7 / 4.4 / 5.2 | 2026-11-25 / 2026-12-03 | 14.6 / 16.8 / 19.7 | 2027-03-02 / 2027-03-22 | 100% | 12.3 of 15 |
| Plan, Dave 12.5 h, WIP 4 | 4.2 / 4.9 / 5.8 | 2026-12-02 / 2026-12-08 | 17.5 / 20.1 / 23.7 | 2027-03-24 / 2027-04-19 | 100% | 10.5 of 12.5 |
| Plan, Dave 12.5 h, Prototype not first | 4.3 / 4.9 / 5.7 | 2026-12-02 / 2026-12-08 | 17.0 / 19.8 / 23.1 | 2027-03-22 / 2027-04-14 | 100% | 10.6 of 12.5 |
| Tiered, before the levers, Dave 12.5 h | 6.3 / 7.5 / 9.1 | 2026-12-21 / 2027-01-06 | 23.9 / 27.8 / 32.6 | 2027-05-17 / 2027-06-18 | 100% | 12.1 of 12.5 |
| Lever 4 too (money core to agents), Dave 12.5 h | 4.0 / 4.6 / 5.5 | 2026-11-30 / 2026-12-07 | 12.5 / 14.4 / 16.8 | 2027-02-11 / 2027-03-01 | 100% | 10.7 of 12.5 |
| Dave merges all, before the levers, 12.5 h | 10.4 / 12.0 / 13.9 | 2027-01-27 / 2027-02-09 | 27.7 / 31.9 / 37.3 | 2027-06-15 / 2027-07-22 | 100% | 12.2 of 12.5 |
| Dave merges all, with the levers, 12.5 h | 4.5 / 5.2 / 6.2 | 2026-12-04 / 2026-12-11 | 19.3 / 22.4 / 26.0 | 2027-04-08 / 2027-05-04 | 100% | 11.4 of 12.5 |
| One engineer full time, no agents | 37.1 / 42.5 / 48.8 | 2027-08-27 / 2027-10-11 | 80.2 / 91.9 / 105.0 | 2028-08-08 / 2028-11-07 | 100% | 30.0 of 30 |
| One engineer full time, agents, merges all | 5.1 / 5.9 / 7.1 | 2026-12-09 / 2026-12-17 | 13.7 / 15.6 / 17.8 | 2027-02-19 / 2027-03-08 | 100% | 18.6 of 30 |
| One engineer full time, agents, tiered | 3.2 / 3.8 / 4.4 | 2026-11-20 / 2026-11-30 | 9.2 / 10.6 / 12.3 | 2027-01-15 / 2027-01-28 | 100% | 21.3 of 30 |
| Two engineers full time, agents, merge all | 3.2 / 3.8 / 4.5 | 2026-11-20 / 2026-11-30 | 7.8 / 9.0 / 10.5 | 2027-01-06 / 2027-01-15 | 87% | 15.7 of 30 |

**Where the people's hours go** (P50 of each term over the runs, total hours across everyone; idle is capacity with nothing ready):

| Scenario | Own units | Gates and people checks | Tasks and weekly work | Idle |
|---|---|---|---|---|
| Plan, Dave 10 h | 122.8 | 74.1 | 16.8 | 29.1 |
| Plan, Dave 12.5 h | 122.8 | 72.9 | 14.4 | 37.4 |
| Plan, Dave 15 h | 122.8 | 72.2 | 12.8 | 45.5 |
| Plan, Dave 12.5 h, WIP 4 | 122.8 | 74.1 | 14.9 | 40.1 |
| Plan, Dave 12.5 h, Prototype not first | 122.8 | 72.8 | 14.4 | 37.5 |
| Tiered, before the levers, Dave 12.5 h | 245.8 | 68.3 | 21.7 | 11.0 |
| Lever 4 too (money core to agents), Dave 12.5 h | 60.9 | 76.2 | 15.0 | 27.0 |
| Dave merges all, before the levers, 12.5 h | 245.8 | 118.9 | 23.3 | 11.0 |
| Dave merges all, with the levers, 12.5 h | 122.8 | 114.1 | 16.1 | 25.5 |
| One engineer full time, no agents | 2683.5 | 0.0 | 70.6 | 0.3 |
| One engineer full time, agents, merges all | 147.6 | 125.9 | 15.5 | 176.8 |
| One engineer full time, agents, tiered | 147.6 | 67.4 | 9.9 | 91.6 |
| Two engineers full time, agents, merge all | 147.6 | 125.9 | 9.0 | 260.4 |

Hours are Dave's focused hours a week; an engineer full time is 30. Tiered: auto-merge as ADR 0010 amended it on 2026-10-20, switched on when U-118 (the merge desk) merges; no fan-out unit merges before it. Standard-tier units merge to `main` on the agents' verdicts. Critical-tier units merge to `integration`, and their dependents build on them there. Dave reads their diffs in a weekly promotion batch, and the launch review waits for the last promotion. Before the switch, and in the "merges all" rows, Dave reads and merges every unit. Tiered rows take the Prototype first and allow 8 open fan-out units unless the row says otherwise. Prototype: U-118, U-001, U-002, U-003, U-116, U-011, U-012, U-111, U-009, U-117, U-018, U-010, U-021a, U-023, U-024, U-025, U-026, U-027, U-030, U-031, U-039, all on `main`. No row reaches 2026-12-01. The plan rows run the record as routed, which carries the freeze decisions: lever 2 (U-093, U-096 built by agents, with Dave's results read as a people check), lever 3 (Dave's share of each unit he leads 0.35 / 0.5 / 0.65), and lever 4a (U-002, U-003, U-116, U-011, U-005, U-024 built by agents). "Before the levers" moves those units back to Dave at his earlier share of 0.5 / 0.65 / 0.8. "Lever 4 too" also hands the money core to agents (not adopted). "With the levers" in a merges-all row adds lever 1: standard-tier units merge on a green verdict. The real-job rows keep U-093 and U-096 with the lead. A unit moved to fan-out keeps its days and gets the full gate, critical-tier read included. WIP: open fan-out units, building or at the gate. Bound: the run finishes more than 15% later than the same draws with every owner full time and free. The work-in-progress limit is 4 open fan-out units per person unless the row says otherwise. 2000 runs per scenario, the same draws in every scenario.
<!-- forecast:resourcing-real-job+should:end -->
