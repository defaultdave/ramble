# ADR 0010: Agent workflow wiring

- **Status:** Accepted 2026-10-18 (Dave), with a change to gate 5: pushing unit branches, opening PRs, and starting PR reviews become automatic once Dave opts in. The first couple of units run with his approval on each action; the goal is fully automatic. Merges to `main`, deploys, issues, and repo creation stay Dave's.
- **Date:** 2026-10-18
- **Question:** R10 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0007 (repository and CI)

## Context

Ramble's second purpose is to show the agent team working: units routed to human-only, human-led, or agent fan-out, with actuals logged (BUILD-PLAN, P4 artifact 5, P5). Three things need deciding: which pipeline runs a unit, where units are tracked, and how actuals are captured.

What exists today:
- **Global entries, available in any repo:** `/senior <unit>` implements in a worktree and stops before push. `/review-pr` runs review, QA, and the specialist checks on a pull request. `/review-swarm` reviews an unpushed branch.
- **The vig squad pipeline** (`/team`, `/foreman`, `/merge-desk`, `/overseer`, `/team-sitter`) lives in vig and loads only inside vig.
- **Gate 5:** every push, pull request, issue, repo creation, and deploy is Dave's.
- **`~/.claude/bin/token-audit`** reports measured token use per agent and project.

## Driving requirements

| Source | Why it matters here |
|---|---|
| BUILD-PLAN purpose 2 | Show the execution model working, with actuals |
| BUILD-PLAN P4 artifacts 3 to 5 | `units.yaml` carries scores, dependencies, routing, estimates, and actuals |
| BUILD-PLAN P5 | Each unit closes with actual days; more than 25% off gets a delta-log line |
| Gate 5 | Dave pushes and opens every pull request |
| C-02, Q-07 | December 1 leaves little slack, so Dave's gate time is on the critical path |

## Options

**Pipeline**

- **A. Global entries.** `/senior <unit>` builds each fan-out unit in its own worktree with the unit's scope manifest. Dave pushes and opens the PR from the printed commands. Then `/review-pr` runs (or `/review-swarm` before push), and the PM checks the files touched against the manifest. Works in this repo today.
- **B. The vig squad pipeline.** More automation (a merge desk, sitters, an overseer), but it would need porting into this repo or running from vig. Setup is a unit of its own, and its automation runs into gate 5 anyway.
- **C. Ad hoc Workflow orchestration per batch of units.** Flexible fan-out, but each batch is a new script and the actuals are harder to compare across units.

**Tracking**

- **1. `units.yaml` only.** One file holds every unit's estimate, status, and actuals; a script computes the critical path. No external tool.
- **2. GitHub Issues and a Project board,** mirroring units. More visible, but Dave creates every issue (gate 5), and two records drift.
- **3. `units.yaml` as the record, mirrored to Issues once the repo is public.** The PM prints the `gh issue create` commands at plan freeze, and Dave runs them.

**Actuals capture**

- Elapsed time: from the unit branch's first commit to its merge commit (git timestamps).
- Human time: Dave logs his minutes on human-only and human-led units, and his gate time (pushes, PRs, reviews) on fan-out units.
- Agent cost: `token-audit --by agent --project ramble` per unit window.

## Recommendation

**Pipeline A, tracking 3, actuals as above.**

- Every unit ticket carries a scope manifest (IN SCOPE, OUT OF SCOPE, REFERENCE CODE).
- `units.yaml` gains `actual_days`, `dave_minutes`, and `tokens` per unit.
- The PM closes each unit only after checking it against its acceptance criteria and manifest.
- **Planning input for P4:** budget Dave's gate time explicitly. With fan-out, the bottleneck is Dave's pushes and reviews, not agent build time.
- **Auto mode (accepted change).** Two modes for pushes to unit branches, opening PRs, and starting PR reviews: *approval* (the pipeline prepares the action and Dave approves each one) for the first couple of units, then *auto* (the pipeline does them itself) once Dave opts in. Switching on auto needs the permission prompts for `git push` and `gh pr create` relaxed for this project, which is Dave's change to make. P4 estimates both modes, since gate time shrinks in auto.

## What would change the call

- Dave's gate time becomes the critical path in P4: consider relaxing gate 5 for pushes to unit branches (never `main`), or batching reviews.
- Fan-out volume makes manual merging the bottleneck: port the vig merge desk as its own unit.
- The repo stays private: tracking 1 is enough.
