# ADR 0012: Bug finder

- **Status:** Proposed 2026-11-21 (drafted for Dave; not accepted)
- **Date:** 2026-11-21
- **Question:** can an agent find one real bug or worthwhile improvement in one area of the site per run, and file it as a ticket the nightly fix agent can take?
- **Depends on:** ADR 0011 (nightly fix agent: same secrets, App, runner layout), ADR 0010 (agent workflow, the App, tiers)
- **Owner calls (2026-11-21):** it runs on GitHub Actions; Dave opts each finding in to the fixer by hand, with a label.

## Context

The nightly audit reads only the last day's diffs, and only by reading code. With merges slowing, it mostly skips. Older code is never looked at again, and nothing runs the site. A finder looks at a whole area whatever its age, and can run it.

What already exists and must not change:
- Agents reach GitHub only as the `defaultdave-agents` App, never with Dave's login (ADR 0010).
- The nightly fix agent takes a ticket only when the App filed it, it carries the `nightly-fix` label (Dave's opt-in), it cites a file outside the off-limits list, and it names a unit (ADR 0011).

## Decision (proposed)

A new workflow, `.github/workflows/bug-finder.yml`, with the same job split as ADR 0011 so no agent shares a runner with the App key. It is `workflow_dispatch` only: there is no schedule until Dave has read the first rounds.

1. **area** (`scripts/bug-finder/area.ts`, no agent). Reads the table in `src/app/README.md` (eight route trees today) and picks by UTC day number modulo the count, so the rotation keeps no state and a newly documented tree joins it. A dispatch input `area` overrides it (`checkout`, `ops`, `browse`: an exact slug or its first words).
2. **investigate** (Claude Code, Sonnet, 60 turns, 45 minutes, no GitHub credential, Postgres service, migrated and seeded database, the built site running):
   - Reads the area's page map and code, the PRD requirements that name its routes, `.claude/standards/architecture.md` and `docs/plan/units.yaml`.
   - Drives the site with Playwright (mobile viewport first) and runs the tests.
   - Writes `finding.json`: one finding, or `{ "none": "<what was checked>" }`.
   - A **bug** needs evidence from this run: a failing test, a Playwright repro, or a `file:line` with the input that breaks it.
   - An **improvement** must cite a PRD requirement or a blocking rule it fails. Taste alone does not count.
   - A finding carries the file and lines, the owning unit, a size, a fix suggestion, and a lens: `bug`, `a11y`, `performance`, `visual` or `rules`.
3. **verify** (a second Claude Code run on a fresh runner, read-only tools): tries to refute the finding from the evidence and the code, and ends with `CONFIRMED` or `REFUTED` as its first line. Anything else, or no verdict, files nothing.
4. **file** (`scripts/bug-finder/file.ts`, a fresh runner, the only one that holds the App key):
   - Validates every field of the finding, and refuses a file that is not in the repository.
   - Checks open and closed `audit` tickets for a duplicate: overlapping lines in the same file, or the same title.
   - Opens one issue as the App, labelled `audit` and `finder`, built from fields only. The first line cites `` `path:line` `` and a `- Unit: U-xxx` line follows, the shape the picker reads.
   - Never adds `nightly-fix`. Adds `needs-owner` when the cited file is off limits or the unit is not in `units.yaml` (the issue then has no `Unit:` line).
   - The run summary says what was checked, even when nothing is filed.

**Change to ADR 0011's picker.** The picker took a ticket only when it named a source PR whose title carries a unit. A finder ticket has no source PR, so the picker also accepts a `- Unit: U-xxx` line from an App-filed ticket labelled `finder` (`unitLine` in `scripts/nightly-fix/pick.ts`). The unit must exist in `units.yaml`; every other rule is unchanged. `nightly-fix.yml` does not change.

**v1 limits, on purpose:**
- One ticket a run at most. The duplicate check runs before filing.
- No code changes, branches or PRs. Fixing is ADR 0011's job, on Dave's label.
- Off-limits files may be cited, but the ticket is labelled `needs-owner`, which the picker skips.

## Security

Same as ADR 0011:
- **The App key lives only on the `file` runner.** The agents run on other runners and hold no GitHub credential.
- **The Anthropic key is exposed to the site and tests the agent runs.** Use the dedicated, spend-capped key from ADR 0011. The database and the site secrets on the investigate runner are throwaway values for a database that dies with the runner.
- **The finding is data.** `file.ts` builds the issue from validated fields and never runs text from it. Paths cannot climb out of the repository or carry backticks, free text is capped, and an `@name` is defanged so a finding cannot notify anyone.
- **The workflow file is protected.** It sits under `.github/`, so changing it is a bypass merge for Dave.

## Cost

About $3 to $8 a run (investigation with the site running plus a short verify), on the same key as the fixer. Run every other night, that is about $60 to $120 a month at the top end. The agent review reads `total_cost_usd` from each job's log, as for ADR 0011.

## Test plan (before any schedule)

1. Dispatch by hand three times (`checkout`, `ops`, `browse`). Dave reads each issue, or each "nothing filed" summary.
2. Dave labels one good ticket `nightly-fix` and dispatches `nightly-fix` by hand: the end-to-end test.
3. After two clean rounds, schedule the finder for 06:00 UTC on alternate days. The fixer stays at 09:00 UTC.

## What Dave does

1. Accept ADR 0011 and this one. One bypass merge carries both workflows.
2. The ADR 0011 secrets and variable: `ANTHROPIC_API_KEY`, `RAMBLE_APP_ID`, `RAMBLE_APP_INSTALLATION_ID`, `RAMBLE_APP_PRIVATE_KEY`, and the variable `CLAUDE_CODE_VERSION`. Nothing new.
3. The labels `nightly-fix`, `finder` and `needs-owner`, if missing.
4. The three hand dispatches above.

## Open questions

- **Tracking (open).** The `audits/` rule wants every item recorded in ramble-pm, and the workflow cannot write there. Proposal: the lead PM adds finder tickets to `audits/finder.md` when folding.
- **Rotation weights (open).** Checkout and sign-in carry the most risk. Weight them double after the first rotation?
- **Rotation under a schedule (resolved for now, must be revisited).** A day-number rotation over eight trees visits only half of them if the workflow runs on every second day (an even step over an even count). Not an issue while it is dispatched by hand. Before scheduling, rotate on a run counter or a week number instead. Chosen for v1: the day number, the simplest stateless option.
- **Where the picker reads the unit (resolved).** The simplest option consistent with ADR 0011: a `- Unit: U-xxx` line, accepted only from an App ticket labelled `finder`, checked against `units.yaml`. No board or project field is read.
- **Which tickets the duplicate check reads (resolved).** Issues labelled `audit`, open and closed, because the nightly audit's tickets carry it. A ticket with no label is not seen.
- **The investigator's server (resolved).** The workflow builds and starts the seeded site before the agent runs, rather than giving the agent build and server commands, so the agent's tool list stays short. It mirrors the booking-path server in `playwright.config.ts`. The first dispatch is the test of that wiring.

## What would change the call

- If the first rounds file mostly refuted or duplicate findings, tighten the prompt or drop the finder before it is scheduled.
- If a filed ticket is fixed by the nightly agent and the fix is wrong, the label stays off finder tickets until the checks are tightened, as for ADR 0011.
