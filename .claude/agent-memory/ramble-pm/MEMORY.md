# ramble-pm memory

Working memory for `ramble-pm`, the agent that runs this project's plan. It holds durable facts a new session needs that the rest of the repo does not make obvious. The spec is `docs/plan/BUILD-PLAN.md`, current state is `docs/plan/STATUS.md`, and decisions with their reasons are in `docs/plan/DECISIONS.md`.

The project owner keeps a second, private memory on their own machine for personal preferences and account details. It is not part of this repository.

## About the project
- Ramble is a demo marketplace for bookable experiences. It exists to prove a planning method and an AI agent team workflow, run as if it were a client engagement for a new site.
- Started 2026-09-28 as a fresh repo with no history from earlier projects.
- Ramble also hosts web performance examples. The best-case build comes first; deliberately slow variants follow later on a separate branch. Detail-page performance fixes are build requirements.

## Where things live
- Figma file: https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp (page "Core flow (desktop)": 6 screens, notes, and a click-through). Screen frame ids: home 2:6, search 2:179, detail 3:2, cart 3:133, checkout 3:253, confirm 3:382.
- Figma component library (built 2026-10-18, direction A "Sunday paper"): node and variable ids plus build lessons in `docs/design/figma-library.json`. Build flow screens from library instances only.
- The Figma file auto-subscribes to community kits (Material 3, Simple Design System, Apple OS kits). Do not build from them (PRD-77).
- Market scan: `docs/product/market/` (`market-scan.md` summary, `teardowns/`). It is context for the PRD; client facts come from the brief.
- Merge desk setup: `docs/plan/merge-desk-runbook.md` (steps and switch-on) and `docs/adr/research/merge-desk-setup.md` (design and cost options).

## Planning scripts
- All read `docs/plan/units.yaml`, the record of units.
- `bun scripts/plan/breakdown.ts --write` regenerates `02-work-breakdown.md` in full; its fixed prose lives in the script.
- `bun scripts/plan/critical-path.ts` (artifact 4) and `bun scripts/plan/execution-model.ts` (artifact 5) each take `--write` to refresh the generated block in their document.
- `bun scripts/plan/forecast.ts --report estimate|resourcing|schedule` simulates the graph with the owner as a capacity-limited reviewer. Scenarios and levers are constants in the script; the owner's review minutes are in `scripts/plan/dave-time.ts`, shared with `execution-model.ts`.
- Roadmap page: `docs/plan/roadmap/status.json` (a hand digest of STATUS and DECISIONS) plus the schedule report, built by `bun scripts/plan/roadmap.ts`.

## Settled decisions (do not reopen)
Full list with reasons in `DECISIONS.md`.
- Domain is bookable experiences, not physical goods (2026-09-16).
- The home page does the discovery job; no separate discovery page. Home blocks are config-driven modules (2026-09-16).
- Single-page checkout; two-step deferred (2026-09-28).
- Mobile first from the design phase on; the desktop v0 is a content inventory (2026-09-28).
- Discovery interviews were skipped on 2026-10-18. The PRD is drafted from `docs/product/discovery/sealed/client-brief.md`, which the PM may read. `ramble-client` stays available for follow-up questions.
- Prior client work is evidence, never a template.
- Build workflow (2026-10-20, ADR 0010): one person plus an agent team. Tiered auto-merge, with standard-tier units merging to `main` and critical-tier units to `integration`, promoted weekly. A Prototype milestone comes first. Switched on 2026-10-21 after the dry run (PRs 137 to 140). It starts with an approval window: the rulesets require 1 approval from the owner until the owner closes it (`approval-window.sh`), and agents request the owner's review on every PR with `agent-git.ts review`.

## Working rules
- Research agents read pages only: never pickers, carts, checkouts, forms, sign-ins, or Playwright on live sites. An agent once clicked into a live checkout.
- Check scope with the owner before launching research beyond the spec's wording.
- The PM never runs a step that changes GitHub settings or Claude permission config.
- User-level `ask` rules (git push, gh pr create/merge) take precedence over project `allow` rules. The runbook's answer is a narrow wrapper, `scripts/merge-desk/agent-git.ts`, allowed per project.
- Call the merge desk scripts as bare commands from the main checkout. The allow rule matches the whole command line, so a `cd … &&` prefix falls through to auto mode, which refuses `automerge`. `revert.sh` switches branches, so run it in a clean worktree (D2 dry run, 2026-10-21).
- A sync PR (`main` into `integration`) needs the three agent checks posted as well as `scope-manifest`; the PM posts them once `scope-manifest` passes (first sync, PR 141).

- Parallel work: when three or more agent-built units are ready with disjoint file scopes, propose running them together, up to 8 open at once. The owner's review time is the real limit. Workflows run only on the owner's opt-in.

## Lessons from the P4 spikes (2026-10-19)
- Figma Code Connect publishing is refused on the Professional plan (Organization or Enterprise only), although Figma's help pages suggested otherwise. See `docs/adr/research/u-028-code-connect-spike.md`.
- A nonce-based CSP needs fully dynamic routes (`instant = false`); never read the nonce in a shared layout. See `docs/adr/research/u-008a-u-009-cache-components-spike.md`.
- Plan files live in the main checkout. Worktrees under `.claude/worktrees/` can be stale.

## Estimating (artifacts 6 and 7, 2026-10-20)
- An estimate-day is 6 focused hours of the unit owner's time, from branch cut to merge-ready. It excludes waiting for merge and the owner's part-time hours (`06-estimate.md`). Solo estimates without agents live in `docs/plan/estimate-panel.json`, not `units.yaml`.
- Summing 115 independent unit draws gives falsely narrow ranges. A per-run systemic factor (0.9 / 1.1 / 1.5) carries the shared error.
- Once owner review time stops being the constraint, the WIP limit takes over (lever 4: reviewer idle at WIP 4).
- The weakest assumption is about 1.1 h of owner review per fan-out gate (7x leverage against a measured 3.4x). Check it at the first three merges.
- The first resourcing draft put the demo in spring 2027 because of review time (about 108 h). That led to the tiered auto-merge change. A December 1 build was out of reach either way (build floor 2026-12-09 to 12-23).

## Freeze and repository (2026-10-20)
- Plan frozen at tag `plan-frozen-2026-10-20` on `8715c42`. Plan files are read-only from then on; reality goes in `docs/plan/delta-log.md`.
- The repository is public, with secret scanning and push protection on.
- Rulesets on `main` and `integration` are live (ids 25513279, 25513280).
- U-118 (merge desk) is the root of the dependency graph; U-001 depends on it.
