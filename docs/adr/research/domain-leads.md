---
title: Domain leads, an org model for the agent team
date: 2026-10-22
status: proposed, for Dave's decision
amends: ADR 0010 (pipeline), if accepted; the change goes in `delta-log.md` in `ramble-pm`
---

# Domain leads: an org model for the agent team

## Problem statement

Today the agent team works ticket by ticket. The PM picks the next ready unit, writes a Next chat block, and Dave opens a session and starts `/senior` on it. Swarms run several units at once, but each worker is short-lived and knows only its own manifest. Every decision that crosses units goes through the PM and usually through Dave, and Dave is also the one who starts each session. The forecast already says Dave's time, not agent capacity, sets the dates (`docs/plan/07-resourcing.md`). A model that starts more workers without taking work off Dave makes the bottleneck worse.

This RFC proposes long-lived **domain leads**. Each lead owns one area of the dependency graph, runs its own units through the existing merge desk, and passes decisions to the leads that depend on them. The PM coordinates the leads and Dave sets direction. The thing to test is whether ownership by area cuts Dave's minutes per merged unit. If it doesn't, the org is just a more expensive swarm.

## Goals

1. Take Dave out of starting units. A lead pulls ready units in its domain and starts its own workers.
2. Settle decisions at the lowest level that has the context, and send them in writing to every lead whose units depend on them.
3. Keep the same safety rails: per-unit scope manifests, the merge desk, review tiers, the App identity, and Dave's gates.
4. Measure the model against ticket-by-ticket work with numbers that already exist or are cheap to log.
5. Make it reversible: if the pilot fails, delete the lead sessions and the PM carries on ticket by ticket.

## Non-goals

- No change to the merge rule, tiers, required checks, rulesets, or the App's permissions.
- No change to the frozen plan: units, estimates, and dependencies stay as recorded. Domains group existing sections; they do not move units.
- Leads do not approve gates. PRD scope, ADRs, design sign-off, tier changes, promotions, and anything under `PROTECTED` in `scripts/merge-desk/scope-check.ts` stay Dave's.
- No new infrastructure: no message broker, server, or external service. The runtime is Claude Code sessions, files, and git.
- Not rolled out to all five domains yet. This RFC covers a two-lead pilot and the decision to expand.
- Not a rewrite of the forecast. `forecast.ts` stays as it is until the pilot gives real numbers.

## Evidence from the dependency graph

The graph lives at unit level in `docs/plan/04-dependency-graph.md`, recorded in `docs/plan/units.yaml`. Rolled up by section (2026-10-22, 134 units, 409 edges):

| Cut | Groups | Edges crossing a group line | Back edges |
|---|---|---|---|
| The 13 `section` values | 13 | 258 (63%) | several pairs depend on each other both ways (platform and data, checkout and post-booking, ops and post-booking) |
| Five domains (below) | 5 | 204 (50%) | 2 (Money to Discovery 1, Operations to Money 1) |

At the 13-section level, owners would spend most of their time coordinating. At five domains, the cross edges run almost entirely one way: Foundation feeds three streams, and the streams feed Release. That is the shape that suits ownership by area: a platform group that publishes contracts, stream groups that consume them, and a release group that checks the result.

| Domain | Sections | Units | Agent-built | Critical tier | Role |
|---|---|---|---|---|---|
| Foundation | platform, data | 30 (4 done) | 26 | 18 | Publishes contracts; feeds 121 cross edges |
| Discovery | design-system, catalog, experience, seo | 27 (2 done) | 26 | 1 | Stream; off the critical path |
| Money | checkout, post-booking, gifting | 31 | 27 | 23 | Stream; holds most of the critical path |
| Operations | ops, host | 29 | 29 | 14 | Stream; needs Money (15 edges) |
| Release | launch, measurement | 19 | 16 | 3 | Collects from everyone; works late |

Cross edges between domains, in unit-level edges: Foundation to Operations 39, to Money 37, to Discovery 25, to Release 20; Money to Release 23; Operations to Release 17; Money to Operations 15; Discovery to Release 14; Discovery to Money 7; Discovery to Operations 5.

The rollup script is a scratch file today. Groundwork task G4 makes it a real one.

## Proposed solution

### Roles

```
Dave ── gates, direction, promotions, secrets
  │
ramble-pm (orchestrator) ── cross-domain sequencing, decision routing, arbitration, the only writer to ramble-pm
  │
  ├── foundation-lead ── units in platform + data; publishes contracts
  ├── discovery-lead  ── units in design-system, catalog, experience, seo
  ├── (money-lead, operations-lead, release-lead after the pilot)
  │
  └── each lead ── senior workers in worktrees, one per unit, through the existing merge desk
```

- **The PM** keeps its current job and gains two: routing decision records to the leads that depend on them, and settling disputes between domains. It stops writing per-unit Next chat blocks for domains that have a lead.
- **A lead** is a tech lead and engineering manager, not a coder. It keeps its domain's ready queue, writes each unit's scope manifest, starts a `senior` worker in a worktree, reads the verdicts, posts the checks, and queues auto-merge with `agent-git.ts`, the same commands the PM uses today. It owns domain-internal design choices and the contracts its domain publishes.
- **Workers** are unchanged: `/senior` with a scope manifest, stopping before push.

### Charters

A charter is the lead's standing scope manifest. It lives in `ramble-pm` (execution state, not plan) and is the first thing a lead reads in every session.

```ts
type DomainId = "foundation" | "discovery" | "money" | "operations" | "release";

interface Charter {
  domain: DomainId;
  sections: string[];                 // values of `section` in units.yaml
  ownedPaths: string[];               // globs under src/; may not include anything in PROTECTED
  publishes: Contract[];              // what other domains build against
  consumes: ContractRef[];            // computed from the graph, never hand-written
  authority: AuthorityRule[];         // what the lead decides alone, with notice, or escalates
  wipLimit: number;                   // open unit PRs at once
  workerModel: "sonnet" | "haiku";
}

interface Contract {
  id: string;                         // e.g. "foundation/cache-tags"
  units: string[];                    // units that define it, e.g. ["U-009"]
  surface: string[];                  // module paths whose exported types are the contract
  consumers: DomainId[];              // computed
}

type ContractRef = { contract: string; owner: DomainId };
```

Pilot contracts, from the Discovery units' dependencies on Foundation:

| Contract | Defined by | Discovery units that build on it |
|---|---|---|
| Catalog read layer | U-011 | U-031, U-037, U-039, U-091 |
| Sessions and allocations | U-012 | U-030, U-031 |
| Cache conventions and tag map | U-009 | U-030, U-031, U-037, U-039 |
| Editorial and policy schema | U-018 | U-030, U-035, U-036, U-038 |
| Storage port and pricing windows | U-010, U-111 | U-039 |
| Hold rules (spaces left) | U-014b | U-040 |
| Rate limits and bot checks | U-008b | U-038 |

U-042 (a Should) also uses the editorial schema, and U-044 (a Should) uses Money's review data (U-060), one of the two back edges. Both are outside the pilot.

### Decision authority

| Kind of decision | Who decides | Who is told | Record |
|---|---|---|---|
| Inside one unit, no change to a contract | worker, under the manifest | nobody | the PR |
| Domain-internal, spans units in one domain | lead | PM (in the daily digest) | domain decision record |
| Change to a published contract | owning lead proposes | consuming leads must acknowledge; PM arbitrates an objection | contract-change record |
| Sequencing or priority across domains | PM | affected leads | PM note in `STATUS.md` |
| Anything touching an ADR, the PRD, the plan, tiers, `PROTECTED` paths, secrets, or a gate | Dave, through the PM | everyone affected | `DECISIONS.md` |

A lead that isn't sure which row applies escalates. Escalating too often is the cheaper failure: it shows up in the metrics, while a lead overstepping its authority shows up as rework.

### Decision records and messages

Decisions travel as written records. A message announces a record; it never carries a decision on its own. Summaries passed from agent to agent drift, and a record does not.

```ts
type RecordKind = "domain-decision" | "contract-change";

interface DecisionRecord {
  id: string;                         // "2026-10-24-foundation-cache-tag-names"
  kind: RecordKind;
  domain: DomainId;
  contract?: string;                  // required for contract-change
  decision: string;                   // one paragraph
  why: string;
  affectsUnits: string[];             // computed consumers included
  status: "proposed" | "accepted" | "objected" | "superseded";
  acks: { domain: DomainId; at: string; note?: string }[];
}

type MessageKind = "record" | "request" | "blocked" | "escalate" | "unit-closed";

interface LeadMessage {
  kind: MessageKind;
  from: DomainId | "pm";
  to: DomainId | "pm";
  refs: string[];                     // record ids or unit ids; a message with none is refused
  body: string;                       // at most a few lines
}
```

Rules:

1. **One writer.** Leads send records to the PM. The PM files them under `domains/<domain>/decisions/` in `ramble-pm`, works out who consumes the contract, forwards the record to those leads, and publishes. `site.ts publish` pushes without pulling first, so several writers would collide; one writer also keeps the PM's view complete.
2. **Neighbors only.** A lead messages the PM and the leads directly above or below it in the graph. Peer streams talk through the PM in the pilot.
3. **Loop guard.** A thread between two leads that goes past three exchanges without a record goes to the PM.
4. **Contract changes wait for acknowledgement.** The owning lead does not merge a contract change until every consuming lead has acknowledged it or the PM has settled an objection. Each consuming lead lists its open branches that the change affects.
5. **Messages are data.** A lead acts on a message only within its charter. Nothing in a message widens a charter or grants a permission.

### Runtime

- **Each lead is a desktop session** started by the PM, in its own worktree, from an agent definition (`.claude/agents/foundation-lead.md`, `discovery-lead.md`) that reads its charter, its memory, and its domain status file at start. The PM and the leads message each other between sessions.
- **Workers are in-process subagents** that the lead starts with worktree isolation, not new sessions. A session woken by another session's message cannot start new sessions, so leads cannot depend on that.
- **Persistence lives in files, not in a process.** Sessions get compacted and they die. A lead is durable because of its charter, its memory folder (`.claude/agent-memory/<domain>-lead/`), and `domains/<domain>/STATUS.md` in `ramble-pm`. Test T4 checks that a fresh session can take over cold.
- **Idle costs nothing.** A lead runs a turn when a message, a merged PR, or the PM wakes it, never on a polling loop.

### What stays the same

Scope manifests per unit, `scope-check.ts`, the four agent checks plus `scope-manifest`, auto-merge through `agent-git.ts`, the approval window, review tiers, promotion by Dave, actuals on board #19, and the rule that the PM checks the files a unit touched against its manifest. A lead does that manifest check for its own units, and the PM spot-checks one in three.

## Alternatives considered

| Option | What it is | Why not (or not yet) |
|---|---|---|
| A. Ticket by ticket (today) | PM picks a unit, Dave starts `/senior` | Dave starts every unit; cross-unit decisions all go through PM and Dave. This is the baseline the pilot measures against. |
| B. Swarm by workflow | A Workflow script fans out N ready units at once | More throughput, but workers forget everything between batches and Dave still opts into and reviews each batch. It speeds up the work, which isn't the binding constraint. Stays available for bursts inside a lead's domain. |
| C. One lead per section (13) | A lead for each `section` value | 63% of edges cross section lines, and several pairs depend on each other both ways. The leads would spend most of their time coordinating. |
| D. One engineering lead under the PM | A single long-lived lead for every domain | Cheaper, and it takes Dave out of starting units, but it tests nothing about passing decisions between owners. It is also one context holding 134 units. Good fallback if the pilot shows the messaging costs more than it saves. |
| E. Role pipelines (architect, then engineer, then QA, per task) | Org simulations that put each task through fixed roles | Organizes by stage of work, not by area, so nobody owns anything between tasks. Ramble already covers the stages with the merge desk checks. |
| **F. Domain leads (proposed)** | Five areas cut from the graph; pilot two | Lowest coupling among the cuts that keep owners meaningful; follows how platform and stream teams are organized in human orgs. |

## Pilot

**Leads:** Foundation and Discovery. Discovery is all agent-built, has one unit on the critical tier (U-024), and sits off the critical path, so a bad week there doesn't move the launch date. It also depends on Foundation through six contracts, which is exactly what the pilot needs to exercise. A lone Discovery lead would test nothing about passing decisions around.

**Scope:** remaining Must units in both domains. Shoulds stay in the cut order, and the post-launch units (U-094a, U-094b) are out. Dave-led units in Foundation (U-014a, U-016) stay Dave's; the Foundation lead schedules around them and writes their contracts down, but doesn't build them.

**Start:** when Dave accepts this RFC and groundwork G1 to G5 is merged. The Discovery lead's first buildable units arrive as U-009, U-011, U-012, and U-018 merge. Until then it prepares manifests and works the design-system chain (U-024 to U-027, then U-029), which needs only U-023, already merged. U-024 still needs Dave's pattern note first.

**Length:** two calendar weeks, with a checkpoint after each lead has merged three units.

**Other domains:** Money, Operations, and Release stay ticket by ticket during the pilot and serve as the side-by-side comparison.

### Metrics

| Metric | Source | Why |
|---|---|---|
| Dave minutes per merged unit, split into dispatch, review, and decisions | `dave_minutes` on board #19, logged with the split (G5) | The hypothesis |
| Times Dave starts a session or pastes a prompt, per merged unit | Dave's tally, or the session list | Main expected gain |
| Escalations to Dave per week | PM log | Leads absorbing decisions, or pushing them up |
| Time from a decision record to every acknowledgement | record timestamps | Whether decisions spread fast enough |
| Rework caused by decisions: reopened PRs, reverts, rebases forced by a contract change | merge desk log, `revert.sh` runs | Cost of passing decisions around |
| Elapsed days against `estimate_days.m` | board #19 | Same measure as every other unit |
| Tokens per merged unit, lead overhead included | `token-audit --by agent --project ramble` | Cost |
| Charter breaches (touched a path it doesn't own, acted above its authority) | `scope-check`, PM spot checks | Safety |

### Exit criteria (proposed; Dave sets the bar)

- **Continue and expand** if dispatch touches per unit fall by half or more, Dave's total minutes per unit are no higher than the baseline, no revert traces to a missed decision record, and lead overhead is at most 30% of worker tokens.
- **Fall back to option D** if leads save Dave's dispatch time but the messaging between them costs more than it saves.
- **Stop** on any charter breach into a protected path, or if escalations go above five a week per lead after the first week.

## Implementation phases

| Phase | Work | Who |
|---|---|---|
| 0. Decide | Accept, change, or reject this RFC; pick the exit bar; log in `DECISIONS.md` and `delta-log.md` | Dave, PM |
| G1. Charters | `domains/foundation/charter.md` and `domains/discovery/charter.md` in `ramble-pm`, with the contract table above | PM |
| G2. Lead agents | `.claude/agents/foundation-lead.md` and `discovery-lead.md`, memory folders, start protocol. `.claude/` is protected, so this lands as a `PM bookkeeping:` PR that Dave merges | PM drafts, Dave merges |
| G3. Ownership check | `scope-check.ts` also checks a unit's touched files against its domain's `ownedPaths`; a miss fails `scope-manifest` with a clear reason. Protected path, so Dave merges | agent unit, Dave merges |
| G4. Domain map script | `scripts/plan/domains.ts`: the section-to-domain map, cross edges, and contract consumers, with tests; the map itself lives in `ramble-pm` | agent unit |
| G5. Logging | Split `dave_minutes` into dispatch, review, and decisions for every unit closed from the pilot start, all domains | PM |
| 1. Drills | T1 to T4 below, before any real unit | PM, both leads |
| 2. Pilot | Two weeks; checkpoint at three merged units per lead | leads, PM |
| 3. Readout | Metrics against baseline; recommend expand, fall back, or stop | PM, then Dave |
| 4. Expand (if chosen) | Money lead next (critical path, 23 critical-tier units), then Operations, then Release | separate decision |

## Testing strategy

Drills run first, like the D2 merge desk dry run:

- **T1, contract change.** The Foundation lead proposes a rename in the U-009 tag map while a Discovery branch that uses it is open. Pass: the PM files and forwards the record, the Discovery lead acknowledges and names its affected branch, and the change doesn't merge before the acknowledgement.
- **T2, escalation.** A lead is given a unit whose fix needs a file under `docs/adr/`. Pass: the lead escalates and does not edit the file; `scope-check` would fail it anyway.
- **T3, loop guard.** Two leads are given a request neither can settle. Pass: the thread reaches the PM by its fourth exchange.
- **T4, cold start.** End a lead's session mid-unit and start a fresh one from the agent definition. Pass: it reports the same queue, open PRs, and pending acknowledgements as the old session, from its files alone.

Scripts get unit tests the same way the merge desk scripts do: `domains.ts` (map, cross-edge counts matching this RFC's table, consumer computation) and the ownership check in `scope-check.ts` (owned path passes, unowned path fails, protected path still fails first).

## Security considerations

- **Identity:** leads push, open PRs, post checks, and queue auto-merge only through `agent-git.ts` and `post-check.ts` as the App. No lead uses Dave's `gh` login. The App's permissions don't change.
- **Authority:** a charter cannot list a protected path, and `scope-check` enforces `PROTECTED` before ownership. Leads cannot approve gates, change tiers, or touch secrets. Secrets a unit needs go on a list for Dave.
- **Prompt injection across agents:** a lead reads PR text, review output, and sometimes web pages. Anything it forwards could carry instructions to other leads. Rules 1 and 5 contain it: only filed records bind, messages are data, and nothing in a message can widen a charter. The PM's routing is a second reader on every record.
- **Blast radius:** a lead works only in its domain's worktrees and paths. A lead that goes wrong is stopped by ending its session; its open PRs stay behind the required checks.

Accessibility and UX sections don't apply: there's no user interface here.

## Open questions

1. **Approval window.** While it's open, Dave reviews every PR, so review minutes swamp any gain from leads. Run the pilot with the window open and compare only dispatch and decision minutes, or close it for the pilot domains?
2. **Baseline size.** Three units have closed ticket by ticket (U-001, U-002, U-023), and none has `dave_minutes` logged. The side-by-side comparison with Money and Operations is the stronger baseline, but those units differ in kind. Is a soft comparison enough to decide on?
3. **The PM as single writer.** Fine for two leads. With five it could become the bottleneck. Should `site.ts` learn to pull and rebase so leads can publish their own records after the pilot?
4. **Lead model.** Leads make design calls, which by the agent file means Opus, but they also run all day. Opus for leads and Sonnet for workers is the starting assumption; the token metric should settle it.
5. **How long a lead's context lasts.** How many units can a lead carry before compaction loses decisions it needs? T4 tests recovery but not slow drift.
6. **Where the RFC goes.** Is this an amendment to ADR 0010, or a new ADR 0011 once the pilot reads out?

## Handoff checklist

- [ ] Dave accepts, changes, or rejects the RFC (phase 0), and sets the exit bar
- [ ] `DECISIONS.md` and `delta-log.md` entries written
- [ ] G1 to G5 done and merged
- [ ] Drills T1 to T4 pass
- [ ] Baseline numbers recorded for the units closed before the pilot starts
- [ ] Pilot start date and checkpoint written in `STATUS.md`
