# ramble-pm memory

## Project
- Ramble = demo marketplace for bookable experiences; proves Dave's planning method + his agent team. Spec: `docs/plan/BUILD-PLAN.md`.
- Repo started 2026-09-28, fresh (no Cat Pass history). Not on GitHub yet.
- Figma file: https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp (page "Core flow (desktop)", 6 screens + notes + click-through). Screen frame ids: home 2:6, search 2:179, detail 3:2, cart 3:133, checkout 3:253, confirm 3:382.
- Figma account (checked 2026-10-18): Full seat, Professional plan, team "Davd Fleming's team", admin. Code Connect fits: one active library, one active framework. The Ramble file is in a team project, so it can be published. The file auto-subscribes to community kits (Material 3, Simple Design System, Apple OS kits); don't build from them (PRD-77).
- Figma library built 2026-10-18 (direction A, Sunday paper). Node and variable IDs plus build lessons: `docs/design/figma-library.json`. Build flow screens from instances only.
- Vault root: `/Users/davidfleming/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dave's Dev Brain/` (not under git; iCloud only).
- Perf Lab brief (2026-10-08, Ramble also hosts perf examples, planted later in a separate branch): vault `Projects/Personal/Ramble Perf Lab - Kickoff.md`. Its detail-page fixes are build requirements per Dave.
- Market scan output: `docs/product/market/` (`market-scan.md` summary, `teardowns/`). It informs the PRD as context only; client facts come from transcripts.

## How Dave wants work run
- Keep research small; add more later when a question needs it. Check scope with him before launching anything beyond the spec's wording (2026-10-16, he cut a 40-agent scan to 13).
- Research agents read pages only: never pickers, carts, checkouts, forms, sign-ins, or Playwright on live sites.

## Settled (don't re-argue)
- Domain is bookable experiences, not physical goods (2026-09-16).
- Home page does the discovery job; no separate discovery page. Blocks are config-driven modules (2026-09-16).
- Discovery + PRD come before research; Ramble is run as a client engagement for a brand-new site (2026-09-28).
- Discovery skipped 2026-10-18: the PRD is drafted from `docs/product/discovery/sealed/client-brief.md`, which the PM may now read. No reveal or discovery delta. `ramble-client` still exists for follow-up questions.
- Single-page checkout; two-step deferred (2026-09-28).
- Mobile first from the design phase on; desktop v0 is content inventory (2026-09-28).
- Prior client work is evidence, never a template.

## Dave
- One item at a time. Hand him the next action, not a list.
- Runs parallel agent teams; estimate around validation gates, not sequential dev time.
- Dave has other commitments alongside Ramble (tracked by Cleo in the vault, not here). Don't schedule around them; ask.
- P4 plan scripts (2026-10-19): `bun scripts/plan/critical-path.ts` (artifact 4) and `bun scripts/plan/execution-model.ts` (artifact 5) read `docs/plan/units.yaml`, the record; each has a `--write` that refreshes the generated block in 04 or 05. `02-work-breakdown.md` is generated from `units.yaml` by `bun scripts/plan/breakdown.ts --write` (artifact 2), which rewrites the whole file; its fixed prose (review rounds, Dave's scope decisions) lives in the script.
- Every hand-off ends with a Next chat block (before you start, run, model and effort, prompt); kept current in STATUS.md under ## Next chat (Dave, 2026-10-19).

## Facts learned in the P4 spikes (2026-10-19)
- Figma Code Connect publishing is refused on the Professional plan (Organization or Enterprise only); Figma's help pages misled the P3 plan check. Details: `docs/adr/research/u-028-code-connect-spike.md`.
- Nonce CSP needs fully dynamic routes (`instant = false`); never read the nonce in a shared layout. Details: `docs/adr/research/u-008a-u-009-cache-components-spike.md`.
- Working checkout for plan files is `/Users/davidfleming/Workspace/ramble` (the worktree under `.claude/worktrees/` is stale and lacks the P4 files).

## Estimate and resourcing (artifacts 6 and 7, 2026-10-20)
- An estimate-day = 6 focused hours of the owner's time, branch cut to merge-ready, excluding the wait for Dave's merge and his part-time hours (06-estimate.md). Solo (no agents) estimates live in `docs/plan/estimate-panel.json`, not units.yaml.
- `bun scripts/plan/forecast.ts --report estimate|resourcing` simulates the graph with Dave as a capacity-limited resource; scenarios and levers are constants in the script. Dave's minutes are in `scripts/plan/dave-time.ts` (shared with execution-model.ts).
- Lesson: summing 115 independent unit draws gives falsely narrow ranges; the per-run systemic factor (0.9 / 1.1 / 1.5) carries the shared error. Once Dave stops binding, the WIP limit binds (lever 4: Dave idle at WIP 4).
- The weakest assumption is about 1.1 h of Dave per fan-out gate (7x leverage vs a measured 3.4x). Watch it at the first three merges.

## Direction change 2026-10-20 (Dave)
- Build is meant to show a one-person-plus-agent-army workflow: tiered auto-merge (standard to `main`, critical to `integration`, Dave promotes weekly) and a Prototype milestone first. Logged in `DECISIONS.md` and ADR 0010. Setup design (GitHub App identity, rulesets with required checks and 0 approvals, auto-merge, cost options): `docs/adr/research/merge-desk-setup.md`. Dave wants as much as possible on GitHub, off his machine, and minimal API cost.
- First resourcing draft put the demo in spring 2027 because of Dave's gate time (about 108 h); that is what prompted the change. December 1 is out of reach either way (build floor 2026-12-09 to 12-23).
- U-118 (merge desk, 2026-10-20) is the graph root; U-001 depends on it. Setup steps and the hard-line edits for switch-on: `docs/plan/merge-desk-runbook.md`. The PM never runs a step that changes GitHub settings or Claude permission config.
- User-level `ask` rules (git push, gh pr create/merge) beat project `allow`; the runbook's answer is a narrow wrapper (`scripts/merge-desk/agent-git.ts`) allowed per project, not lifting the global prompts.
- Executive roadmap (Dave, 2026-10-20): refresh and republish it at the end of every session. `docs/plan/roadmap/status.json` (hand digest of STATUS and DECISIONS) + `forecast.ts --report schedule --out docs/plan/roadmap/schedule.json` + `bun scripts/plan/roadmap.ts`, then publish `docs/plan/roadmap/index.html` to https://claude.ai/artifact/8vvxU5shDbM9uQkYSTLEiw.
- Plan frozen 2026-10-20: tag `plan-frozen-2026-10-20` on `8715c42` (history rewritten first to drop personal notes). Repo public. Rulesets on `main` and `integration` are live (ids 25513279, 25513280); Dave's login bypasses them, so PM bookkeeping commits still push as him. App IDs are in `~/.config/ramble-agents/app.conf` (no Client ID recorded; token script falls back to the App ID).
