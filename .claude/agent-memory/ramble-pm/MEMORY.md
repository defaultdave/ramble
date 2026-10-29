# ramble-pm memory

Working memory for `ramble-pm`, the agent that runs this project's plan. It holds durable facts a new session needs that the rest of the repo does not make obvious. The spec is `docs/plan/BUILD-PLAN.md`, current state is `STATUS.md` and decisions with their reasons are `DECISIONS.md`, both in the `ramble-pm` repo.

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
- Roadmap page: `roadmap/status.json` in `ramble-pm` (a hand digest of STATUS and DECISIONS) plus the schedule report, built by `bun scripts/plan/roadmap.ts` into that repo's `index.html` and README.
- `ramble-pm` (since 2026-10-22) is the project's viewable state: status, decisions, delta log, roadmap. `scripts/plan/site.ts` finds its checkout (beside the main checkout, or `RAMBLE_PM_DIR`) and publishes it straight to `main` as the App. Unit status and actuals live on board #19.

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
- A sync PR (`main` into `integration`) needs the four agent checks posted (`architecture-audit` joined them on 2026-10-22) as well as `scope-manifest`; the PM posts them once `scope-manifest` passes (first sync, PR 141).

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
- Plan frozen at tag `plan-frozen-2026-10-20` on `8715c42`. Plan files are read-only from then on; reality goes in `delta-log.md` in `ramble-pm`.
- The repository is public, with secret scanning and push protection on.
- Rulesets on `main` and `integration` are live (ids 25513279, 25513280).
- U-118 (merge desk) is the root of the dependency graph; U-001 depends on it.

## Lessons from Prototype wave 1 (2026-10-24)
- Builders run in parallel worktrees, commit, and stop. The PM pushes with `agent-git.ts push` from the main checkout, but must run `agent-git.ts pr` from the unit's worktree, because it takes the current branch as the head.
- `agent-git.ts` cannot force-push or edit a PR body. Never rebase a pushed branch (merge `main` into it instead, or build a merge commit with the rebased tree), and carry each review round's notes in the posted check summaries.
- A promotion PR whose head is `integration` deletes `integration` when it merges: the repo deletes head branches on merge, and a merge under the owner's login bypasses the ruleset's deletion rule.
- Standard-tier units that depend on a critical-tier unit cannot start until that unit is promoted to `main`.
- Adversarial re-reviews keep finding the same class of defect (unbounded work, the database accepting what Zod rejects). Ask each round to sweep the whole class, not only the reported instance.
- UI units get an independent Figma-vs-Storybook check (a general-purpose agent with the Figma read tools), beside the a11y audit.
- Once a unit branch has deployed a Vercel preview, fix a migration with a new migration, never by editing it in place: the edit regenerates the journal timestamps and the preview database tries to re-apply it (U-011, PR 189).

## Lessons from Prototype wave 2 (2026-10-26)
- Agent reviews do not run the CI-only checks. gitleaks (it scans every commit in the PR, so a fix commit cannot clear a flagged test secret; use low-entropy fake values from the start), CodeQL, and `build` with no database caused four of the wave's rounds. Builders run gitleaks over the branch range and build with `DATABASE_URL` unset before reporting.
- Run Playwright e2e through a shared lock (`lockf`) with `CI=1` when builders share a machine: the config serves on a fixed port and otherwise reuses any server already there.
- Launch reviewers from the main checkout. `token-audit` attributes a subagent's cost to the folder the session was in when it launched, so reviewers started from a unit's worktree inflate that builder's cost.
- Builders sometimes commit on a detached HEAD. Check `git status -sb` in the worktree before pushing, and fast-forward the unit branch if needed.
- Parallel units that each add a migration collide on the number. The second to land merges the first and regenerates its migration.
- Haiku narrow checks get stricter between rounds on unchanged code (B2, B6). The PM rules from the standard's text and logs the ruling, rather than sending the builder another round.

## Lessons from the rolling Prototype build (wave 3, 2026-10-26 to 27)
- Architecture audits surfaced B2 findings (domain decisions left in the data layer) one round at a time; U-012 and U-018 each took four rounds. Builder rules now say every domain decision, including a rule hidden in a write path's SQL `WHERE`, lives in a `src/lib` function with a unit test, and review rules require the full B2 list in round 1.
- Reviewers and QA must mutate code only in their own scratch worktree (`git worktree add <path> <sha> --detach`); two checks once mutated the builder's worktree at the same time.
- A data unit owns its tables' read and write contracts, including guest reads its first consumer needs; page units own rendering (DECISIONS 2026-10-26).
- Builders' sandboxes refuse `gitleaks git --log-opts`; the PM reruns the range scan before every push.
- Hand-written migration SQL (triggers, seed rows) goes in its own `db:generate --custom` migration, so renumbering after another unit's migration stays mechanical.

## Lessons from the rolling Prototype build (2026-10-28)
- A session may not edit files in another session's worktree. Fixers therefore run in their own isolated worktree on a `wip/<unit>-r<n>` branch cut from the reviewed head; the PM fast-forwards `unit/<unit>` to the final head and pushes. Merges of `main` that need no hand resolution can be built with `git merge-tree` and `git commit-tree`, with gates run in a scratch checkout.
- Never type a full commit SHA from memory or by extending a short one; copy it from `git rev-parse` output. Twice a wrong SHA reached a workflow's arguments and the run had to be stopped.
- After a unit passes review, merging `main` can still break it without a textual conflict (U-031 deleted a read that a newly merged seed test called). Run every gate and a focused four-check re-check on the merge commit before posting checks.
- A fixer's scope manifest must name every item the PM directs it to change; reviewers fail anything outside the IN SCOPE line, including the PM's own additions.
- Start PM sessions from the main checkout, not a worktree: from a worktree the PM cannot write its own memory files.
- Launch every agent that uses an isolated worktree (workflows and the Agent tool alike) with the shell in the ramble checkout: the worktree is cut from the current directory, which persists between commands. Launches while the shell sat in ramble-pm gave the U-010 fixer, the U-005 fixer, and the U-014a builder ramble-pm worktrees (2026-10-28); the builder cloned ramble inside it, and `site.ts publish` then committed the folder as a submodule pointer. `cd` back to ramble before every launch; ramble-pm ignores `.claude/worktrees/` since then.
- Check `git -C <ramble> status -sb` after a review fan-out: a reviewer once left the main checkout on a detached HEAD at the reviewed commit (2026-10-28, PR 222).
- Sync PR checks come from reviewer agents that verify the sync (head equals main, a fast-forward or a reviewed conflict resolution, every commit through a merged PR), never from verdicts the PM writes itself; auto mode refuses the latter as self-approval (2026-10-28, PR 212).
- Audits: after each section or major feature reaches `main`, run an audit pass (architecture, code and DRY, accessibility, visual at six breakpoints against Figma, PRD-68 performance), findings only, and log every item raised anywhere in `audits/` in the ramble-pm repo with an ID and status (owner, 2026-10-28).
- Reuse before writing is blocking rule B17 in `.claude/standards/architecture.md`; builder and review rules point at it.

## Several PM sessions at once (2026-10-28)
- PM chats run in lanes (agent file, **Several sessions at once**): claim a row in `## Lanes` in `STATUS.md` before working; the lead alone writes the `Updated` line, `## Next`, `## Blocked on Dave`, the roadmap, and memory; a lane writes only its own section, Next chat block, audit and board rows, and dated appends. Each lane's "For the lead" notes carry what the lead must fold in. Two sessions sharing one checkout lost only shared lines and whole-file regenerations, never edits inside separate sections.

## Lessons from the home-fixes lane (2026-10-28)
- Reviewer and QA agents launched from the PM session run in the sandbox, which refuses localhost Postgres (`connect EPERM`), Docker, Chromium, and port binding; builders got the bypass. Either allow local binding in the sandbox settings before a fan-out, or have the PM run the runtime checks (db suite, mutation check, screenshots) outside the sandbox and say so in the check summaries.
- Running two lanes' db suites at the same time exhausts the shared Postgres (`FATAL 53300 too many connections`, 118 failures that vanish on rerun). Rerun before reading a failure as real, or serialise db suites through a lock like the e2e one.
- `pnpm test -- <file>` and `pnpm test:db -- <file>` run the whole suite in this repo; the filter does not narrow it.
- A git worktree cut by the Agent tool cannot stat `.env.example` inside the sandbox, so `git status` shows it deleted and `git diff <rev>` (worktree) shows a 65-line deletion; the commit is fine. Check a commit's content with `git diff <base> <head>`, never against the worktree.
- `agent-git.ts automerge` prints nothing on success; read the PR's `autoMergeRequest` with `gh pr view --json` to confirm.
- Two parallel follow-ups on one page (hero layout, home skeleton) need an ordering rule: the branch that mirrors another lands second and merges `main` first. Name the dependency in both briefs.

## Lessons from the lead lane (2026-10-29)
- A refactor proposal written against one commit needs its move table re-verified against `main` before builders start: a workflow of one manifest agent per PR plus two verifiers per manifest (correctness, completeness) found stale lines in every PR and a wrong caller in most. The file-overlap matrix it produced showed every PR touching the same four page modules, so the PRs run one at a time, each merging `main` before its push, never in parallel.
- `bun scripts/plan/forecast.ts --report schedule` takes any scenario name from its `SCENARIOS` list in `--scenarios "a|b"`; `Lever 4 too (money core to agents), Dave 12.5 h` models the human-led money units on agents. The model prices units at their estimates with review gates and does not carry measured agent actuals (merged units closed at 4 to 42 percent of estimate), so its dates are the slow case.
- Inside the sandbox `gh` cannot read the keychain login (`Failed to log in to github.com account (keyring)`), so `scripts/plan/board-dates.ts --run` and other `gh` reads fail there; `site.ts publish` and the merge-desk scripts still work because they use the App token. Hand the board sync to the owner or run it outside the sandbox.
- The Prototype milestone in `07-resourcing.md` includes half a day of stub glue (checkout and confirmation placeholders filled with U-027's components and fixture data) that has no unit and was never built; a milestone's "glue outside units.yaml" needs a tracking row or it is forgotten.
