---
name: plan-project
description: Use this skill when work starts from a concept, a client brief, or a request for an estimate rather than from a ticket. Runs intake, then produces the project plan as seven artifacts in order (design doc, work breakdown, complexity and uncertainty scores, dependency graph with its critical path, execution model, range estimate, resourcing options), a client-facing proposal, and one ticket per unit with a scope manifest, ready for `/senior` or `/team`. Trigger on "new project", "new client", "client brief", "kickoff", "discovery", "proposal", "statement of work", "how long will this take", "how many people does this need", "estimate this", "plan this project", or when `decompose-ticket` finds the work is over the planning bar.
argument-hint: <brief text, or a path to notes or a doc> [--dir <plan-dir>]
---

# plan-project — from a concept to tickets

A technical plan says what to build. This skill produces the project plan: what it costs, what can run in parallel, and what each staffing option buys. It ends with tickets an implementer or an agent squad can take, and a log that later shows where the estimate was wrong.

| Stage | Produces | Stop for the user |
|---|---|---|
| 1. Intake | `brief.md`, the project's `stack-decisions.md` | Yes: confirm the brief |
| 2. The bar | A go or a hand-off to `decompose-ticket` | Only when below the bar |
| 3. Seven artifacts | Design doc, `plan.json`, `plan-report.md` | Yes: confirm path, routes, and range |
| 4. Proposal | `proposal.md` | |
| 5. Launch check | A pass or a list of what is missing | |
| 6. Tickets | `tickets/<nn>-<unit-id>.md`, the issue and run commands | |
| 7. Delta | `delta-log.md` | |

Everything goes in the plan directory: `docs/plan/` in the target repo, or the path after `--dir`. The brief and the proposal can hold commercial terms, so before the first write ask once whether the plan directory is committed with the repo or kept local, and use a gitignored path for the second answer.

Templates are in this skill's `templates/` directory. A worked example is in `references/`: `example-plan.json` and the report it produces.

## 1. Intake

Read everything supplied first: the brief, notes, emails, designs, and the existing repo when there is one. Then fill `templates/brief.md`, asking only for what the material leaves open. Ask in rounds of up to four questions, each one carrying its own context so it can be answered without the conversation above it.

- **Outcome first.** One sentence: what changes, for whom, and the measure that shows it worked. Everything else hangs off it.
- **Appetite next: fix the time, then fit the scope.** Ask what the work is worth in weeks, not how long it will take. The plan is cut to the appetite; when the report's floor or the lead's own time runs past it, units are cut or parked before the build starts, not after. Ramble was planned at months for a demo wanted in days, re-aimed three times, and saved its date by cutting 24 units mid-build.
- **Name the first walkable milestone.** The smallest thing the decision-maker can click through end to end, and when they want it. It becomes `first_milestone` in `plan.json`, and the report gives its own floor. On Ramble the owner asked for a walkable UI four times in nine days before it was planned for.
- **Hold the discovery conversation.** Appetite and the milestone come from talking to the decision-maker, not from the written brief. When it is skipped, write why in the brief.
- **Non-goals are required.** Write what the project will refuse to do, in the client's words where possible.
- **An unknown the client owns becomes a row in "Open with the client"**, with the unit it blocks. Planning continues on a stated assumption, recorded with what changes if it is wrong.
- **Designs, when the work has a visible surface.** Ask who designs it and in what: supplied by the client, or made before code in a `design` unit (a Figma file through the Figma MCP, a Claude Design artifact, or both compared). The answer goes in the brief's "Designs" row; a `design` unit goes in the plan with the shell and every page unit depending on it. On the portfolio site (2026-11-06) this question was never asked, and the unit was added after the range review, which moved the critical path and the lead's hours.
- **Existing repo:** inspect it. Record the stack, which quality gates exist and run in CI, and where the layout departs from `$CLAUDE_PROJECT_DIR/.claude/vig/standards/architecture.md`.
- **Stack:** copy `$CLAUDE_PROJECT_DIR/.claude/vig/standards/stack-decisions.md` to `<repo>/.claude/standards/stack-decisions.md` and fill it from the brief and the repo. A client's fixed choice goes in the last column; a fixed rule the project cannot follow goes under Departures with its reason.

Exit check: the user confirms the outcome sentence, the appetite, the first walkable milestone, the non-goals, and the constraints.

## 2. The bar

The full plan is required when any one of these is true:

| Trigger | Meaning |
|---|---|
| Over two weeks | of work for one person |
| Over one person | or more than one team touching it |
| An outside date | a launch, a contract, a customer promise |
| A replacement | anything with an old system to retire |

Tick the boxes in the brief. With none ticked, say so, and hand the brief to `decompose-ticket`: a ticket and a decomposition are enough. With one or more, every artifact below is produced before the first commit.

## 3. The seven artifacts

Produce them in order. Each has one exit check; pass it before starting the next.

| # | Artifact | What it settles | Exit check |
|---|---|---|---|
| 1 | Design doc | What is built, and what is not | Non-goals written; alternatives considered |
| 2 | Work breakdown | Units small enough to estimate | Every unit is a week or less, or has a spike before it |
| 3 | Complexity and uncertainty | Which units are risky, on two axes | Two scores on every unit |
| 4 | Dependency graph | The critical path, and what runs beside it | `plan.mjs` runs with no errors |
| 5 | Execution model | Who, or what, does each unit | A route on every unit, overrides explained |
| 6 | Estimate | A range, with the uncertainty visible | A range per path and a cross-check |
| 7 | Resourcing case | What each staffing option buys | The options table, down to the row where another person adds nothing |

**1. Design doc.** Run the `design` skill with the brief as input. When a design doc or an implementation plan already exists, read it and fill only what it lacks. For a React or Next.js project the design settles four seams, in this order: the server and client boundary, the data access layer, where presentation logic lives, and the design-system primitives.

**2. Work breakdown.** Cut Capability → Slice → Task. Cut by what a user can do first, then by layer. A unit is a slice: about a week or less, and assignable to one person or one agent. A unit nobody can estimate is too big or needs a spike. Add the units a gut estimate forgets, each with its `kind`: `preflight`, `review`, `qa`, `launch` (a staged ramp with exit criteria), and `tail`. A project with a visible surface and no supplied designs also gets a `design` unit (kind `build`, `human_only: true`, no dependencies) that the shell and every page unit depend on; name its deliverable from the brief's "Designs" row and cap it at its estimate, because it is the unit most likely to eat the appetite. The tail is on the plan from the first draft: retiring the old system when this is a replacement; removing flags, scaffolding, and deferred edge cases when it is new. Write the units into `plan.json` from `templates/plan.json`.

**The preflight unit comes first.** Every account, plan tier, quota, secret and ruleset the build needs is set up before the first build unit starts, from a runbook (`templates/preflight.md`) that the agent drafts and walks through as a dry run before the lead does it for real. The GitHub side (public repo, rulesets with required checks, the agents' GitHub App, the CI and security workflows, the merge-desk scripts, the project board) follows `references/project-setup.md`, distilled from Ramble; a project that fans units out to agents also gets a `merge-desk` unit (human-led, after `scaffold`) that every fan-out unit depends on, because Ramble's breakdown forgot it and added it mid-build. It is the lead's unit: it routes human only, and every build unit that touches a service depends on it. List the caps that bite on a free or hobby tier (deploys per day, database branches, storage), because each one stops work on the day it is hit. Secrets go straight from the provider into the env store and `.env`; never through a chat. On Ramble this work happened in chat, mid-build: two console sessions of 34 and 27 messages, a database password pasted into a transcript, and a deploy cap and a branch cap that each blocked a day.

**3. Scores.** Score complexity and uncertainty separately, 1 to 3 each. A large, well-understood unit is safe; a small, unknown one is not. A unit with uncertainty 3 gets a `spike` unit in its `depends_on`, and its estimate is revisited when the spike closes.

**4. Dependency graph.** Give every unit its `depends_on`. Then run:

```bash
node $CLAUDE_PROJECT_DIR/.claude/skills/plan-project/bin/plan.mjs <plan-dir>/plan.json > <plan-dir>/plan-report.md
```

The report holds the critical path, the float on every other unit, the routes, the staffing table, and the graph as Mermaid. Fix every error and answer every line under Checks before going on.

**5. Execution model.** The script routes each unit from its scores and its place on the graph. Uncertainty is the routing variable; complexity is not.

| Route | When | Runs as |
|---|---|---|
| human only | Uncertainty 3, a spike, the preflight, or `human_only: true` (architecture, product intent, security, anything irreversible) | The person |
| human-led | Uncertainty 2, or uncertainty 1 on the critical path | A person owns the decisions; `/senior <ticket>` does the typing and the tests |
| agent fan-out | Uncertainty 1 and off the critical path | One worktree each: `/foreman start` in vig, one `/senior` session per ticket elsewhere |

Set `route` on a unit only to override the derived one, and write the reason in the unit's `notes`. The report lists every override.

**6. Estimate.** Every unit gets three figures: optimistic, most likely, pessimistic. The script turns them into `(o + 4m + p) / 6` and a range on the critical path. Spend the estimating care on the units the report marks as on the path, then run it again.

- **A unit a person owns is estimated in working days** (`estimate`).
- **An agent-built unit is estimated in review rounds** (`rounds`), with `owner_minutes`: the person's time on it across every round, reading verdicts, answering questions, merging. Review rounds, not build time, set an agent-built unit's pace, and agent-day estimates run far over the actual (Ramble: a median actual of 0.23 of the likely figure). Set `assumptions.round_days`, the elapsed days one round takes: build or fix, CI, review.
- Estimate in days first so the graph can route the units, then re-estimate the units the report routes to agent fan-out in rounds and run it again. The report's Checks list any unit whose route and unit of estimate disagree.
- Rounds depend on how strict the checks are. Pin the reviewers' severity rules before treating a round as a unit of work.
- The pessimistic figure is required, and it is the case where something goes wrong.
- Set `assumptions.join_buffer`: units that fit alone still have to fit together, at every join in the graph.
- Fill `reference_class` with finished work of the same kind (unit count and actual days). The report compares this plan against it.
- Write the estimate before discussing a number with anyone, then compare.
- Quote the range. A single date is a promise nobody asked for.

**7. Resourcing case.** The staffing table in the report is the case: each option, its duration, and what binds it. Keep the last row, where another engineer adds nothing; it shows the table describes the work. Agent-built units estimated in rounds produce the fan-out rows from their owner minutes; a unit still estimated in days needs `assumptions.agent_review_fraction` instead. Add the token budget for the fan-out units as a line item.

**The lead's hours are an input, and they are measured.** Set `assumptions.owner_hours_per_week` to the hours the person running the project will actually give it, and `focus_hours_per_day` if a day is not 6 focused hours. The report's Owner time section totals the hours the plan needs and turns them into weeks at that rate. When those weeks are longer than the floor, the lead's hours set the date, not the graph, and the proposal says so. On Ramble the plan assumed 10 to 15 hours a week and the owner gave about 40, unrecorded; the date moved by cutting scope.

Say in the proposal that rounds per unit, owner minutes, owner hours a week and the review fraction are assumptions until the delta log measures them. Calibrate after the third agent-built unit merges (stage 7, Delta), not at the end.

Stop here. Show the user the critical path, the routes, the range, the staffing table, the owner-time weeks, and the first milestone against the appetite, and confirm them before writing the proposal or any ticket. A plan past its appetite is cut here, with the user, not during the build.

## 4. Proposal

Fill `templates/proposal.md` from the brief and the report. It is the client-facing summary: outcome, non-goals, the range, the options, milestones with observable exit checks, what the client supplies and by when, and the tail. Commercial terms are the user's to fill in.

## 5. Launch check

Agent fan-out works only behind hard gates, because at volume the gate is the review. Before any unit goes to an agent, confirm:

- The repo has build, lint, typecheck, and test scripts, and CI runs them on every merge.
- `.claude/standards/stack-decisions.md` is filled, and the project's layer paths match `architecture.md` or the project has its own copy.
- Every fan-out unit has acceptance criteria, a scope manifest with `in_scope_globs`, and no open question.
- The estimate of record is written into `delta-log.md` with its date.
- Each review round leaves a record (a check run or a verdict file, fails included), and the owner-time figures in the Measures table have a source.
- The preflight unit is closed: every row in `preflight.md` is done, each cap has a stated workaround, and no secret was typed into a chat.

A unit that fails the third line is routed human-led until it passes.

## 6. Tickets

Write one file per unit from `templates/ticket.md` into `<plan-dir>/tickets/`, numbered in dependency order. A unit too large to narrate in two sentences goes through `decompose-ticket` first.

Then print, for the user to run:

- one `gh issue create --title "<title>" --body-file <ticket-file>` line per ticket;
- the run order: units with no unfinished dependency first, a dependent unit as soon as its base branch exists;
- the command for each route, from the table in artifact 5.

## 7. Delta

`delta-log.md` (from `templates/delta-log.md`) closes the loop.

- **Estimate of record:** the unit table, the path range and the owner-time assumptions, dated at the launch check. Later changes are new dated rows under Re-estimates; the original rows stay as written.
- **Actuals:** per unit, as each one closes, with the reason for the difference. The reason is what improves the next estimate. Agent-built units record rounds and owner minutes as well as days.
- **Recorded by tools, not by memory.** A field someone has to remember to fill stays blank: on Ramble, owner minutes were 0 or empty on nearly every row. Collect each figure from something that already runs:
  - Rounds: post one check run or verdict file per review round, fails included, and count them per unit at merge.
  - Owner minutes and owner hours a week: from the owner's message timestamps in the project's transcripts. No script in this skill does it yet.
- **Calibrate after the third agent-built merge.** Set `round_days`, the rounds and `owner_minutes` on the remaining agent-built units, and `owner_hours_per_week` from the medians measured so far, set `assumptions.calibrated` to the date, and run the script again. Record it as a Re-estimate row. The forecast learns from actuals here, or it does not learn.
- **Measures, weekly:** the seven numbers in the template's Measures table, each against its target. A number moving the wrong way two weeks running goes to the user that week.
- **Re-estimate at each milestone:** update the remaining units in `plan.json` and run the script again. A range still wide past the midpoint goes to the client that week.
- **Read-back at the end:** where the estimate was furthest off and why, the measured round length, owner minutes per agent-built unit and owner hours a week, and one new `reference_class` entry for the next plan.

## The plan file

`plan.json` is the single source for artifacts 2 to 7.

| Field | Meaning |
|---|---|
| `project`, `recorded` | Name, and the date the estimate was recorded |
| `appetite_weeks` | What the work is worth in weeks; the report flags a floor or lead's time past it |
| `first_milestone` | `{ title, units }`: the smallest walkable thing; the report schedules those units and their prerequisites on their own |
| `assumptions.join_buffer` | Days added to each unit with two or more dependencies |
| `assumptions.round_days` | Elapsed days one review round takes; required when any unit is estimated in rounds |
| `assumptions.owner_hours_per_week` | Hours a week the lead gives the project; the Owner time section turns the plan's hours into weeks at this rate |
| `assumptions.focus_hours_per_day` | Focused hours in one estimate-day, 6 when unset |
| `assumptions.calibrated` | Date the assumptions were reset from measured actuals; `null` until then |
| `assumptions.agent_review_fraction` | For an agent-built unit still estimated in days: share of its duration that needs an engineer, above 0 and at most 1 |
| `reference_class[]` | `{ name, units, days }` for finished work of the same kind |
| `units[].id`, `title`, `capability` | Identity; `id` is what `depends_on` refers to |
| `units[].kind` | `build` (default), `preflight`, `spike`, `review`, `qa`, `launch`, `tail` |
| `units[].depends_on` | Ids that must finish first |
| `units[].complexity`, `uncertainty` | 1 to 3 each |
| `units[].estimate` | `{ o, m, p }` in working days, for a unit a person owns |
| `units[].rounds`, `owner_minutes` | `{ o, m, p }` in review rounds, and the person's minutes across them, for an agent-built unit; in place of `estimate` |
| `units[].human_only`, `route`, `notes` | Force a person; override the derived route; say why |

`node --test $CLAUDE_PROJECT_DIR/.claude/skills/plan-project/lib/plan.test.mjs` runs the script's tests.

## What other entries own

- Writing the design doc: `design`.
- Cutting one unit into reviewable PRs: `decompose-ticket`.
- Implementing a ticket: `/senior`, or `/team` and `/foreman` inside vig.
- Creating issues, pushing, and sending anything to the client: the user, from the printed commands.
