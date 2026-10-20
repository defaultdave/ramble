---
artifact: 5 (execution model)
status: draft for Dave, 2026-10-19
record: docs/plan/units.yaml (execution, execution_reason, review, acceptance_by_people)
script: scripts/plan/execution-model.ts
---

# Ramble: execution model

> **Updated 2026-10-20 for the plan freeze (Dave; DECISIONS 2026-10-20).** The generated report below is current; the prose after this note describes the routing as approved on 2026-10-19. What changed:
> - **U-118, the merge desk and agent identity,** was added. It is human-led, because only Dave may create GitHub settings, and on the critical tier.
> - **Levers 2 and 4a moved eight units to agents.** U-093 and U-096 are built against fixtures, with Dave's results read as a people check. The six pattern-setters (U-002, U-003, U-116, U-011, U-005, U-024) carry Dave's pattern note and sit on the critical tier.
> - **Lever 3:** agents carry half of each unit Dave leads (`DAVE_SHARE` 0.35 / 0.5 / 0.65).
> - **The gate model is tiered auto-merge** (ADR 0010 amended), with the old merge-everything rule kept as a comparison column.
> - **Result:** Dave leads 9 of 116 demo units, and agents build 107; 53 are on the critical tier. His time outside his own units is about 67 h, or 3.7 h a week over 18 weeks; artifact 7 schedules it with his units.

## Headline

**Agents build 99 of the 115 demo units, and Dave leads 16.** Uncertainty decides who builds; complexity and risk decide how hard the review is.

49 of the 115 demo units (43%) are on the critical review tier. 41 of them are agent-built, and Dave reads their diffs himself; he leads the other 8.

**Dave's time is the constraint, twice over:**

- **His review time on the agent-built units.** The gates, people checks, recurring weekly work, and his account tasks come to about 93 h likely (44 to 215 h as the sum of the extremes). That is about 15.6 h a week over six weeks in auto mode after the first three units; approval mode adds about 8 h.
- **His own 16 units.** They run one at a time and, on this graph, finish later than the graph does: 40 points against 26, or 31.65 if agents carry the last 35% of each (the likely share).

Artifact 7 puts both on one Dave lane, in days, and compares one engineer with two.

## The three routes

| Route | Who builds it | Dave's part | Pipeline (ADR 0010) |
|---|---|---|---|
| Agent fan-out | The senior agent, in its own worktree, from the unit's scope manifest | The gates: approvals while in approval mode, the review verdict, the diff on critical units, the merge to `main` | `/senior <unit>`, push, PR, `/review-pr`, the PM's manifest check, and Dave's merge; critical units add `/review-swarm` on the branch before push |
| Human-led | Dave, with agents on the pieces (tests, stories, fixtures, boilerplate) | Most of the unit | Dave's branch, the same reviews, Dave's merge |
| Human-only | Dave | All of it | No agent build (no unit is routed here today) |

## The routing rule

- **Uncertainty decides who builds a unit.** Uncertainty 1 and 2: agent fan-out, because the scope and the design doc say what done looks like and the tests can prove it. Uncertainty 3: human-led, because the unknown may change the plan, and that call is Dave's.
- **Complexity decides how hard the review is**, not who builds. It sets the review minutes.
- **Two kinds of override, each with its reason in `execution_reason`:**
  - *Pattern-setters.* The first unit of each kind that agents will copy is human-led: the walking skeleton, the database wiring and migration conventions, the first schema and DAL module, the caller check, the outbox, the lock order, the ledger, the first components, the first money action, the webhook intake, and `confirmOrder`. Later units of the same kind are fan-out against that pattern.
  - *Dave's hands or judgment.* The screen-reader walk (U-100) and the launch go or no-go (U-104). The restore and cutover rehearsals are people checks inside fan-out units (U-099, U-115), not overrides. Real phones and wallets (U-101) are human-led by the matrix (uncertainty 3), so they need no override. No unit is human-only.
- **Review tier.** A unit is on the critical tier when it writes money rows, takes a lock or adds code inside a transaction that holds one, grants or checks access, computes the amounts charged or refunded, or carries the real-database race tests for them. Critical adds three things to the standard review: `/review-swarm` runs before push, the unit's race or access tests must be in its own diff, and Dave reads the diff himself before merging.
- **Acceptance that needs people.** Seven fan-out units end with a check only a person can run: the content sign-off (U-021b), usability timings (U-068, U-074c), rehearsals (U-097, U-099, U-115), and the first staged production deploy (U-103). Each carries Dave's minutes in `units.yaml`.

The script fails if any unit lacks a route or a review tier, sits off the matrix with no reason, or sits on the matrix with a stale reason.

```bash
bun scripts/plan/execution-model.ts --write docs/plan/05-execution-model.md
```

## What the review changed

All three review rounds are described in `04-dependency-graph.md`. For routing and Dave's time, they changed these things.

- **Routes:**
  - U-004a moved to fan-out, because U-116 now sets the caller pattern.
  - Backups (U-098) and the cutover runbook (U-115) moved to fan-out, with the rehearsals as people checks.
  - Real phones (U-101) moved from human-only to human-led, by the matrix.
  - U-116 is human-led as a pattern-setter. U-117 is fan-out.
- **Review tier:**
  - 15 units moved onto critical (13 in round 1, U-054 and U-087 in round 2). U-087 moved back off in round 3, so 14 stay there. The new U-116 started on critical.
  - The rule now covers code inside a locking transaction, the race tests, and the amounts charged or refunded, so every critical unit qualifies by the rule, not by exception.
  - U-050 moved on a round 1 finding that its verifier never judged; round 2 confirmed the move.
- **Dave's time.** Round 1 found touchpoints the first model missed, all now in the script:
  - rebases and their re-reviews;
  - CI and manifest escalations;
  - preview checks on host and ops screens, which have no drawn design;
  - the close on every unit;
  - per-unit minutes for people checks;
  - the weekly bookkeeping merge, CI triage, and production promotions;
  - twelve account and settings tasks the first list missed.

  Rounds 2 and 3 fixed the counting:
  - the first promotion is no longer counted twice;
  - recurring work starts at a unit's planned finish;
  - the post-launch tail is counted once;
  - P4 tasks are out of the P5 total;
  - human-only units hold Dave for their whole length;
  - the path gate figure covers the heaviest tied chain.
- **The Dave lane** is computed (`levelledSchedule` in `scripts/plan/graph.ts`), and his units are listed in the order he takes them.
- **Not applied (refuted):** U-073, U-047b, or U-100 changing route, and U-084 going critical.

## Dave's gate time

The generated report below has the full table. What matters:

- **Reading costs more than approving.** Auto mode saves about 8 h over approval mode, because the approvals are 5 minutes a unit. The two big terms are:
  - reading review verdicts and merging: about 26 h;
  - critical-tier diff reads: about 24 h.

  Rebases come next (about 10 h), then escalations (8 h).
- **The weekly figure is the one to check against Dave's calendar.** It is about 15.6 h a week of gates and tasks, before his own units. It already leaves out the Shoulds; keeping them cut is what holds it there. If his P5 hours fall short, the levers are:
  1. Merge standard-tier units on a green review verdict without reading it. This cuts part of the 13 h that the 56 standard-tier fan-out units carry in the verdict term.
  2. Batch reviews into two sittings a day, which cuts rebase churn (about 10 h in all).
  3. Give access-only critical units a test-only read, which saves under 5 h.
  4. Add a second reviewer for the critical tier (artifact 7).
- **The minutes are assumptions.** Each is a named constant in the script, with a three-point range. P5 replaces them with `dave_minutes` actuals at the calibration points the report names.

## How many fan-out units at once

- **The graph is wide.** It allows about 9 units in parallel on average and up to 16 at one depth, so agent capacity is not the limit.
- **Dave's review rate is the limit.** A fan-out unit costs him about 46 minutes of gate time on average (76 h over 99 units, auto mode). The demo's 99 fan-out units over six weeks means about 16 merges a week, or about 12.5 h a week of gates alone.
- **Proposal: a work-in-progress limit.** Allow at most as many open fan-out PRs as Dave can review in two days, starting at 4. When one merges, the PM starts the next ready unit with the least slack. This keeps branches fresh, holds rebase churn down, and stops the queue from hiding a review backlog. The limit rises once auto mode is on and the first calibration is in. If the merge queue becomes the bottleneck, port the vig merge desk as its own unit (ADR 0010, "What would change the call").
- **Dave's own units follow the lane order in the report**: least latest start first, which takes the zero-slack money core early. The units with lots of slack (U-093, U-008a) come late. The Cache Components spike may drop U-008a to uncertainty 2, and so to fan-out. U-093 has no spike (DECISIONS, 2026-10-18), so only the open routing question below can move it.

## Calibrating in P5

- **What each unit records.** It closes with:
  - `actual_days`: git timestamps from the first commit to the merge;
  - `dave_minutes`: Dave logs them at the close;
  - `tokens`: `token-audit --by agent --project ramble` over the unit's window.

  A unit more than 25% off its estimate gets a delta-log line (BUILD-PLAN, P5).
- **Refit points**, named in the report:
  - approvals and the verdict minutes after the first three fan-out merges;
  - the critical-tier read after the first two critical-tier fan-out merges;
  - the C3 rows after the first C3 fan-out merge.

  After the freeze, a refit is a delta-log line and a new forecast. The frozen estimate stays as it was.
- **Re-score after the P4 spikes.** The combined Cache Components spike answers U-008a and U-009, and the Neon spike (U-013) informs U-003 and U-014a. A unit whose uncertainty drops to 2 moves to fan-out by the matrix, which takes it off Dave's lane and adds its gates. Moving U-008a and U-009 cuts Dave's busy time from 41 to 37 points and the strict lane from 42 to 40; all of that finish gain comes from U-009. The likely-share lane barely moves (31.5 to 31.65), and the gates add under 1 h.
- **An open routing question for Dave.** U-093 (the redirect map) and U-096 (the load test) are uncertainty 3 because of facts outside the code: the old site, and real traffic. In the demo, agents could build both against fixtures, with Dave reading the results. Moving them, plus U-008a and U-009 after the spike, takes the strict lane from 42 to 37 points, and the likely-share lane from 31.5 to 30.4. The PM recommends deciding this at the artifact 7 resourcing review, with days in hand.

## Generated report

<!-- execution-model:report:start -->
Generated by `bun scripts/plan/execution-model.ts --weeks 18 --weight points`. Do not edit by hand.

**Checks.** Every unit is routed and has a review tier; every unit off the matrix has a reason, and no unit on it carries one.

**Routing by complexity (C) and uncertainty (U)**, all 135 units. Each cell: the matrix route, then how many units went to each route.

| | U1 | U2 | U3 |
|---|---|---|---|
| C1 | agent-fan-out: 19 agent-fan-out | agent-fan-out: 6 agent-fan-out | human-led: 1 human-led |
| C2 | agent-fan-out: 28 agent-fan-out | agent-fan-out: 3 human-led, 48 agent-fan-out | human-led: 2 human-led, 1 agent-fan-out |
| C3 | agent-fan-out: 1 human-led | agent-fan-out: 4 human-led, 20 agent-fan-out | human-led: 1 human-led, 1 agent-fan-out |

**Routes by scope:**

| Scope | Units | Human-only | Human-led | Agent fan-out | Critical review |
|---|---|---|---|---|---|
| Demo build (P5, Foundation and Must) | 116 | 0 | 9 | 107 | 53 |
| Shoulds, if the cut order keeps them | 14 | 0 | 0 | 14 | 4 |
| Real job only (estimated, not built) | 1 | 0 | 1 | 0 | 1 |
| Post-launch tail | 2 | 0 | 0 | 2 | 0 |
| P4 spikes | 2 | 0 | 2 | 0 | 1 |

**Off the matrix** (10 units; each needs a reason):

| Unit | Title | C | U | Matrix | Routed | Why |
|---|---|---|---|---|---|---|
| U-118 | Merge desk and agent identity | 2 | 2 | agent-fan-out | human-led | Creates the GitHub App, rulesets, and secrets, which only Dave may do (ADR 0010); sets the merge rule every unit runs through, so it lands before the first fan-out unit merges |
| U-014a | Holds core and reserveSpaces | 3 | 2 | agent-fan-out | human-led | First locking path; sets the lock order (device, session, hold, order, gift) every money path follows |
| U-016 | Ledger and its views | 3 | 1 | agent-fan-out | human-led | The two-account ledger and the posting helper every money path calls |
| U-047a | startPayment action | 3 | 2 | agent-fan-out | human-led | First money Server Action: idempotency key, live-attempt reuse, tries limit |
| U-048 | Webhook intake and the event table | 3 | 2 | agent-fan-out | human-led | Webhook verification and the event table every confirm branch reads |
| U-049 | confirmOrder for bookings | 3 | 2 | agent-fan-out | human-led | `confirmOrder`, the single confirm function; the gift, exchange, and refund branches copy it |
| U-093 | Redirect map and guide import | 2 | 3 | human-led | agent-fan-out | Demo: agents build it against fixtures and Dave reads the results (lever 2, DECISIONS 2026-10-20); in the real job it stays human-led, because the old site and real traffic are outside facts |
| U-096 | Load test | 3 | 3 | human-led | agent-fan-out | Demo: agents build it against fixtures and Dave reads the results (lever 2, DECISIONS 2026-10-20); in the real job it stays human-led, because the old site and real traffic are outside facts |
| U-100 | Accessibility pass | 2 | 2 | agent-fan-out | human-led | The keyboard and screen-reader walk is Dave's; an automated score is not a pass |
| U-104 | Launch readiness review | 2 | 2 | agent-fan-out | human-led | Dave runs the review and makes the go or no-go call; the PM assembles the evidence |

**Human-led by the matrix** (uncertainty 3): U-013 Concurrency spike on Neon (P4 spike); U-028 Code Connect spike (P4 spike); U-046 Stripe Connect adapter (real job only); U-101 Device matrix and wallets.

**Fan-out units on the critical review tier** (47 in the demo build, 51 with the Shoulds; they write money rows, take a lock or add code inside a transaction that holds one, grant or check access, compute the amounts charged or refunded, or carry the real-database race tests for them): U-002, U-003, U-004a, U-004b, U-116, U-005, U-006, U-011, U-111, U-014b, U-015, U-017, U-020, U-022, U-024, U-045a, U-109, U-106, U-050, U-052, U-054, U-055, U-056, U-057, U-059, U-107, U-062a, U-063, U-064a, U-064b, U-065a, U-065b, U-066a, U-066b, U-067, U-068, U-070, U-072, U-073, U-112, U-074a, U-077, U-113, U-108, U-079a, U-079b, U-081, U-085, U-086, U-088, U-114.

**The Dave lane.** The human-led and human-only units share one Dave. Run one at a time, the demo build finishes at 34 points against the graph's 28, with Dave busy for 23 of them. If agents carry the last 50% of each human-led unit (the likely share), it finishes at 28.5. Gate time is not on this lane in points; artifact 7 adds it once the units carry days.

Dave's order (when he is free, he takes the ready unit with the lowest latest start; then the least slack):

| # | Unit | Title | Graph start | Slack | Lane start | Weight | Why human |
|---|---|---|---|---|---|---|---|
| 1 | U-118 | Merge desk and agent identity | 0 | 0 | 0 | 2 | Creates the GitHub App, rulesets, and secrets, which only Dave may do (ADR 0010); sets the merge rule every unit runs through, so it lands before the first fan-out unit merges |
| 2 | U-014a | Holds core and reserveSpaces | 9 | 0 | 9 | 3 | First locking path; sets the lock order (device, session, hold, order, gift) every money path follows |
| 3 | U-048 | Webhook intake and the event table | 12 | 0 | 12 | 3 | Webhook verification and the event table every confirm branch reads |
| 4 | U-016 | Ledger and its views | 11 | 1 | 15 | 3 | The two-account ledger and the posting helper every money path calls |
| 5 | U-047a | startPayment action | 12 | 2 | 18 | 3 | First money Server Action: idempotency key, live-attempt reuse, tries limit |
| 6 | U-049 | confirmOrder for bookings | 15 | 0 | 21 | 3 | `confirmOrder`, the single confirm function; the gift, exchange, and refund branches copy it |
| 7 | U-100 | Accessibility pass | 22 | 2 | 28 | 2 | The keyboard and screen-reader walk is Dave's; an automated score is not a pass |
| 8 | U-101 | Device matrix and wallets | 22 | 2 | 30 | 2 | uncertainty 3 |
| 9 | U-104 | Launch readiness review | 26 | 0 | 32 | 2 | Dave runs the review and makes the go or no-go call; the PM assembles the evidence |

**Acceptance that needs people** (Dave's time inside fan-out units):

| Unit | Check | Minutes (o, m, p) |
|---|---|---|
| U-021b | Dave approves the curated content against the PRD-77 tone checklist | 120, 210, 360 |
| U-068 | The 5-minute publish-a-week usability check (PRD-41) | 45, 60, 120 |
| U-074c | The timed 20-minute host onboarding walkthrough across U-074a to U-074c | 30, 45, 90 |
| U-093 | Dave reads the agent-built redirect map against the old site export (lever 2) | 30, 45, 90 |
| U-096 | Dave reads the agent-built load test results against the fixtures (lever 2) | 30, 45, 90 |
| U-097 | The probe-failure rehearsal with Dave | 30, 50, 100 |
| U-099 | The rollback and restore rehearsals with Dave, including the one restore rehearsal before launch | 60, 100, 200 |
| U-115 | The staging cutover rehearsal with Dave (switch order, redirect check, back-out) | 45, 90, 150 |
| U-103 | Dave runs the first staged production deploy and the printed promote command | 20, 30, 60 |

**Dave's gate time** (fan-out gates, plus the close on human-led units; minutes are assumptions):

| Scope | Fan-out units | Tiered auto-merge (plan of record) | Dave merges all, auto after the first 3 | People checks |
|---|---|---|---|---|
| Demo build (P5, Foundation and Must) | 107 | 35.5 h (15.3 to 92.7) | 82.1 h (36.8 to 195.9) | 11.3 h (6.8 to 21.0) |
| Shoulds, if the cut order keeps them | 14 | 3.2 h (1.0 to 9.2) | 8.4 h (3.3 to 21.3) | 0.0 h (0.0 to 0.0) |
| Real job only (estimated, not built) | 0 | 0.0 h (0.0 to 0.1) | 0.0 h (0.0 to 0.1) | 0.0 h (0.0 to 0.0) |
| Post-launch tail | 2 | 2.8 h (1.3 to 6.4) | 4.1 h (2.1 to 9.1) | 0.0 h (0.0 to 0.0) |

The tiered column leaves out the weekly promotion itself, 9.0 h (4.5 to 18.0) over 18 weeks, which is in the total below. Units merged before U-118 (the merge desk) would go through Dave; none is a fan-out unit, because U-001 depends on it.

**Where the demo gate time goes** (tiered auto-merge):

| Term | Hours |
|---|---|
| critical-tier diff reads in the promotion batch | 26.3 h (15.2 to 47.5) |
| weekly promotion | 9.0 h (4.5 to 18.0) |
| escalation | 8.9 h (0.0 to 44.6) |
| close on human-led units | 0.3 h (0.1 to 0.6) |

Likely hours, with the sum of the optimistic and pessimistic points in brackets; the true range is narrower, since not every unit lands at its extreme.

**Recurring work over 18 P5 weeks** (start points from the planned schedule; the weeks are artifact 6's likely build length):

| Work | Count | Minutes each (o, m, p) | Total |
|---|---|---|---|
| Merge the PM's bookkeeping PR | 18.0 weeks | 5, 10, 20 | 3.0 h (1.5 to 6.0) |
| Triage red nightly or main CI runs; merge the fix-forward PRs (from U-105's merge) | 3.9 weeks | 15, 45, 120 | 2.9 h (1.0 to 7.7) |
| Production promotions after U-103's first one (weekly, plus the launch release) | 3.0 releases | 10, 20, 45 | 1.0 h (0.5 to 2.3) |

**Dave's tasks outside the units:** before the build (P4) 0.4 h (0.3 to 0.8); during the build 4.7 h (2.5 to 8.8); the real job adds 1.8 h (0.9 to 3.8).

| Task | When | Scope | Phase | Minutes (o, m, p) |
|---|---|---|---|---|
| Create the Neon project for the concurrency spike | P4, before U-013 | demo | P4 | 10, 15, 30 |
| Publish the Figma library | P4, before U-028 | demo | P4 | 5, 10, 20 |
| Create the Project board and its fields; run the printed issue commands | plan freeze | demo | P5 | 20, 40, 75 |
| Tag the plan freeze and approve the P5 start | end of P4 | demo | P5 | 10, 20, 30 |
| Neon project for the build, the Vercel integration for preview branches, the staging branch | U-003 | demo | P5 | 10, 20, 45 |
| Neon API key as a GitHub secret for the branch-cleanup step | U-003 | demo | P5 | 5, 10, 20 |
| Vercel project, environment variables, first preview deploy | U-002 | demo | P5 | 15, 30, 60 |
| Blob store (or an S3-compatible bucket) and its token for the storage port | U-010 | demo | P5 | 5, 10, 20 |
| Cloudflare R2 buckets and keys (locked audit export, hourly dump); Neon API key for the restore test | before U-020 and U-098 | demo | P5 | 15, 25, 45 |
| Sentry, Better Stack, and Axiom accounts and keys | U-007, U-097 | demo | P5 | 20, 35, 60 |
| MFA on every vendor account (GitHub, Vercel, Neon, Sentry, Better Stack, Axiom, Figma, Cloudflare) | U-102 | demo | P5 | 15, 30, 60 |
| Make the repo public (DECISIONS, 2026-10-18); turn on CodeQL default setup and secret push protection | plan freeze | demo | P5 | 10, 15, 25 |
| Main ruleset requiring the U-001 CI checks | U-001 | demo | P5 | 5, 10, 20 |
| Add the U-105 smoke to the ruleset's required checks | U-105 | demo | P5 | 2, 5, 10 |
| Vercel firewall rate-limit rule on the shared beacon path prefix (Hobby allows one) | U-008b | demo | P5 | 5, 10, 20 |
| GitHub Actions secrets for the pulse workflow (it runs from Actions once the repo is public) | U-005 | demo | P5 | 5, 10, 20 |
| Figma access token for publishing Code Connect | U-029 | demo | P5 | 5, 10, 20 |
| Email provider account and sending-domain records | real job (the demo uses the dev mailbox) | real-job | P5 | 20, 40, 90 |
| Cancel the site builder and its plugin; keep the domain | U-094b, real job | real-job | P5 | 5, 10, 20 |
| Domain cutover: DNS records and TLS for the live address; Search Console verification and access for the U-093 page export and the U-094a crawl-error reviews | U-093, U-115, and launch, real job | real-job | P5 | 30, 60, 120 |

**Demo build, Dave's time outside the human-led units** (tiered auto-merge): 67.3 h (32.1 to 156.5), about 3.7 h a week over 18 weeks. The human-led units come on top, at 35 to 65% of their elapsed days (lever 3); artifact 7 schedules both.

**Gates on the critical path.** Under tiered auto-merge a path unit waits for its agent checks, not for Dave: critical-tier units land on `integration` and their dependents build on them there. Dave's batch read happens off the path, except that the launch review (U-104) waits for the last promotion. Escalations on the path's fan-out units (U-001, U-003, U-011, U-012, U-050, U-051, U-064b, U-065b) are the only gate time on it.

**Calibration points.** Refit ESCALATION after the first 3 fan-out merges (U-001, U-003, U-002); CRITICAL_READ and PROMOTION after the first two promotions, which carry the first critical-tier units (U-003, U-002); the C3 rows after the first C3 fan-out merge (U-005). After the freeze, a refit is a delta-log line; the frozen estimate stays.

<details><summary>Every unit: route, review tier, Dave's likely gate minutes</summary>

| Unit | Title | C | U | Route | Review | Tiered | Dave merges all (auto) |
|---|---|---|---|---|---|---|---|
| U-001 | Repository setup and CI gates | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-118 | Merge desk and agent identity | 2 | 2 | human-led | critical | share of days | share of days |
| U-002 | Walking skeleton | 1 | 1 | agent-fan-out | critical | 20 | 35 |
| U-003 | Database wiring and migrations | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-004a | Sign-in links, roles, and sessions | 2 | 2 | agent-fan-out | critical | 35 | 62 |
| U-004b | Passkeys and step-up | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-116 | Caller and role contract | 1 | 1 | agent-fan-out | critical | 20 | 35 |
| U-117 | Rich-text format and renderer | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-005 | Jobs outbox, drain route, and the pulse | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-006 | Email port and dev mailbox | 2 | 1 | agent-fan-out | critical | 35 | 62 |
| U-007 | Logging and error tracking | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-008a | CSP and security headers | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-008b | Rate limits and bot checks | 2 | 2 | agent-fan-out | standard | 5 | 32 |
| U-009 | Cache conventions and tag map | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-010 | Storage port and photo ingest | 2 | 1 | agent-fan-out | standard | 5 | 32 |
| U-011 | Catalog schema and read layer | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-012 | Sessions, templates, and allocations | 2 | 2 | agent-fan-out | standard | 5 | 32 |
| U-013 | Concurrency spike on Neon | 2 | 3 | human-led | critical | share of days | share of days |
| U-111 | Pricing and cancellation windows | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-014a | Holds core and reserveSpaces | 3 | 2 | human-led | critical | share of days | share of days |
| U-014b | Hold rules and upkeep | 2 | 2 | agent-fan-out | critical | 35 | 62 |
| U-015 | Orders, attempts, events, refunds, transfers schema | 2 | 1 | agent-fan-out | critical | 35 | 62 |
| U-016 | Ledger and its views | 3 | 1 | human-led | critical | share of days | share of days |
| U-017 | Gift tables and state machine | 2 | 1 | agent-fan-out | critical | 35 | 62 |
| U-018 | Editorial and policy schema | 2 | 1 | agent-fan-out | standard | 5 | 32 |
| U-019 | Guests, consents, and privacy | 2 | 2 | agent-fan-out | standard | 5 | 32 |
| U-020 | Audit log | 1 | 1 | agent-fan-out | critical | 20 | 40 |
| U-021a | Seed script and scale fixture | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-021b | Curated content and photo pool | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-022 | Authorization matrix test | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-023 | Token export and CSS custom properties | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-024 | Primitives: controls and feedback | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-025 | Primitives: content and navigation | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-026 | React Aria wrappers | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-027 | Order summary, booking bar, booking panel | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-028 | Code Connect spike | 1 | 3 | human-led | standard | share of days | share of days |
| U-029 | Code Connect mapping | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-030 | Home page and module renderer | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-031 | Browse with URL filters | 3 | 2 | agent-fan-out | standard | 5 | 37 |
| U-032 | Zero results with ways forward | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-033 | Filter drawer and extra filters | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-034 | Keyword search | 1 | 2 | agent-fan-out | standard | 5 | 20 |
| U-035 | Category and neighborhood pages | 1 | 2 | agent-fan-out | standard | 5 | 20 |
| U-036 | Ramble Picks and gift guide pages | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-037 | Guide-only entries | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-038 | Help center, legal, accessibility, contact | 2 | 1 | agent-fan-out | standard | 5 | 32 |
| U-039 | Experience page content | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-040 | Upcoming dates and spaces left | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-041 | Booking bar, sheet, and panel | 3 | 2 | agent-fan-out | standard | 5 | 42 |
| U-042 | Structured data and share images | 1 | 2 | agent-fan-out | standard | 5 | 20 |
| U-043 | Private session request | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-044 | Review display | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-045a | Payments port and fake adapter | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-045b | Fake payment UI and event simulator | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-046 | Stripe Connect adapter | 3 | 3 | human-led | critical | share of days | share of days |
| U-047a | startPayment action | 3 | 2 | human-led | critical | share of days | share of days |
| U-047b | Checkout page | 3 | 2 | agent-fan-out | standard | 5 | 37 |
| U-048 | Webhook intake and the event table | 3 | 2 | human-led | critical | share of days | share of days |
| U-049 | confirmOrder for bookings | 3 | 2 | human-led | critical | share of days | share of days |
| U-109 | Refund path in confirmOrder | 3 | 2 | agent-fan-out | critical | 50 | 87 |
| U-106 | Paying-hold lapse job | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-050 | Confirmation page and order status | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-051 | Checkout failure states | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-052 | Payment race and idempotency tests | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-053 | Checkout script inventory and PCI | 1 | 2 | agent-fan-out | standard | 5 | 20 |
| U-054 | Booking emails | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-055 | Manage booking and cancelBooking | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-056 | Refund processing | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-057 | Move a booking | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-058 | Reminder emails | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-059 | Session cancellation fan-out | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-060 | Review invites, collection, and storage | 2 | 1 | agent-fan-out | standard | 5 | 32 |
| U-061 | Review moderation basics | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-107 | Guest account: my bookings | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-062a | purchaseGift and the gift-purchase confirm | 3 | 2 | agent-fan-out | critical | 50 | 87 |
| U-062b | Gift checkout and gift-scheduled pages | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-063 | Gift delivery | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-064a | redeemGift and the redemption confirm | 3 | 2 | agent-fan-out | critical | 50 | 87 |
| U-064b | Gift redemption page | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-065a | Gift exchange: confirm branch | 3 | 2 | agent-fan-out | critical | 50 | 87 |
| U-065b | Gift exchange: page and top-up | 2 | 2 | agent-fan-out | critical | 35 | 57 |
| U-066a | Gift expiry and buyer refunds | 2 | 1 | agent-fan-out | critical | 35 | 57 |
| U-066b | Gift reinstatement | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-067 | Host shell and access | 1 | 1 | agent-fan-out | critical | 20 | 45 |
| U-068 | Publish a week and edit sessions | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-069 | Guest lists | 1 | 1 | agent-fan-out | standard | 5 | 30 |
| U-070 | Host cancels or retimes a booked session | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-071 | Statements and payouts | 2 | 2 | agent-fan-out | standard | 5 | 37 |
| U-072 | Host staff access | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-073 | Ops shell, passkeys, and audit wiring | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-112 | Ops staff and roles admin | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-074a | Host setup | 2 | 1 | agent-fan-out | critical | 35 | 67 |
| U-074b | Experience editor | 3 | 2 | agent-fan-out | standard | 5 | 47 |
| U-074c | Availability setup | 3 | 2 | agent-fan-out | standard | 5 | 47 |
| U-075 | Experience review and approval | 2 | 2 | agent-fan-out | standard | 5 | 37 |
| U-076a | Editorial editing and publish | 2 | 2 | agent-fan-out | standard | 5 | 37 |
| U-076b | Home and collections admin | 2 | 1 | agent-fan-out | standard | 5 | 37 |
| U-076c | Pages and documents admin | 2 | 1 | agent-fan-out | standard | 5 | 37 |
| U-077 | Bookings, cancellations, and refunds | 3 | 2 | agent-fan-out | critical | 50 | 92 |
| U-113 | Ops gift support | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-108 | Ops session management | 3 | 2 | agent-fan-out | critical | 50 | 92 |
| U-078 | Settings and ops switches | 2 | 2 | agent-fan-out | standard | 5 | 37 |
| U-079a | Weekly release and transfer events | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-079b | Reconciliation and close-out | 3 | 2 | agent-fan-out | critical | 50 | 82 |
| U-080 | Finance export | 2 | 1 | agent-fan-out | standard | 5 | 37 |
| U-110 | Money-held view | 1 | 1 | agent-fan-out | standard | 5 | 30 |
| U-081 | Dispute record | 2 | 1 | agent-fan-out | critical | 35 | 72 |
| U-082 | Spreadsheet import | 2 | 2 | agent-fan-out | standard | 5 | 37 |
| U-083a | Support queue | 1 | 1 | agent-fan-out | standard | 5 | 30 |
| U-083b | Private requests queue | 1 | 1 | agent-fan-out | standard | 5 | 30 |
| U-084 | Trust and safety | 2 | 2 | agent-fan-out | standard | 5 | 42 |
| U-085 | Privacy requests | 2 | 2 | agent-fan-out | critical | 35 | 67 |
| U-086 | Events table and beacons | 2 | 2 | agent-fan-out | critical | 35 | 62 |
| U-087 | Attribution capture | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-088 | Investor report and funnel | 2 | 1 | agent-fan-out | critical | 35 | 62 |
| U-089 | Web-vitals field data | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-090 | Live dashboard and cohorts | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-091 | Address scheme and slug history | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-092 | Sitemaps, robots, and crawler checks | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-093 | Redirect map and guide import | 2 | 3 | agent-fan-out | standard | 5 | 27 |
| U-094a | Post-launch redirect fixes | 1 | 2 | agent-fan-out | standard | 160 | 226 |
| U-094b | Decommission the old site | 1 | 2 | agent-fan-out | standard | 5 | 20 |
| U-095 | Lighthouse budgets and lab runs | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-096 | Load test | 3 | 3 | agent-fan-out | standard | 5 | 37 |
| U-097 | Uptime, heartbeats, SLO, synthetic booking | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-114 | Synthetic booking isolation | 3 | 2 | agent-fan-out | critical | 50 | 87 |
| U-098 | Backups and restore rehearsal | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-099 | Runbooks and rehearsal | 2 | 1 | agent-fan-out | standard | 5 | 27 |
| U-115 | Launch cutover runbook and rehearsal | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-100 | Accessibility pass | 2 | 2 | human-led | standard | share of days | share of days |
| U-101 | Device matrix and wallets | 2 | 3 | human-led | standard | share of days | share of days |
| U-102 | Scanning and secrets | 1 | 1 | agent-fan-out | standard | 5 | 20 |
| U-103 | Staged releases and freeze rule | 2 | 2 | agent-fan-out | standard | 5 | 27 |
| U-104 | Launch readiness review | 2 | 2 | human-led | standard | share of days | share of days |
| U-105 | Booking-path smoke and nightly suite | 2 | 2 | agent-fan-out | standard | 5 | 27 |

</details>
<!-- execution-model:report:end -->
