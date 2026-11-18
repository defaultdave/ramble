# ADR 0011: Nightly fix agent

- **Status:** Proposed 2026-11-18 (drafted for Dave; not accepted)
- **Date:** 2026-11-18
- **Question:** can one audit ticket a night be fixed without Dave's computer being on?
- **Depends on:** ADR 0007 (GitHub Actions), ADR 0010 (agent workflow, the App, tiered auto-merge)

## Context

The nightly audit (`ramble-nightly-audit`, a scheduled task on Dave's Mac) files findings as tickets in the Maintenance sprint. Fixing them needs a lead PM chat on the same Mac. Small, well-described tickets (one file, a named fix) wait days for a chat that could have closed them overnight.

What already exists and must not change:
- Agents reach GitHub only through `scripts/merge-desk/` as the `defaultdave-agents` App, never with Dave's login.
- `scope-manifest` and `human-read` decide the tier from `units.yaml`; a critical-tier PR waits for Dave's approval of its head.
- Required check runs (`review-agent`, `qa-agent`, `spec-compliance`, `architecture-audit`) are posted with `post-check.ts`.
- Issue 999: files that steer the checks (`package.json`, lint and test config, `.gitleaksignore`) are not yet protected, so an agent PR that touches them could pass every check.

## Options

| Option | For | Against |
|---|---|---|
| **A. GitHub Actions workflow running Claude Code (recommended)** | App token from repo secrets, so `agent-git.ts` and `post-check.ts` run unchanged; Docker and Postgres on the runner; every existing gate applies | Needs an Anthropic API key as a repo secret; the agent's `pnpm test` runs in the same step as that key |
| B. Claude Code cloud scheduled task | No workflow to maintain; same agent loop as a local chat | Pushes through the Claude GitHub connection, not the App, so the merge-desk route would need rework; secrets in an environment are plain text |
| C. Keep it local, wake the Mac | No new moving parts | Exactly the dependency this removes |

## Decision (proposed)

Option A: `.github/workflows/nightly-fix.yml`, daily at 09:00 UTC, after the local audit and `nightly-smoke`.

1. **pick** (`scripts/nightly-fix/pick.ts`, no agent). Picks the lowest-numbered open ticket that:
   - is labelled `audit` and `nightly-fix`, the label being Dave's opt-in for that ticket;
   - was filed by the App, so a ticket from anyone else cannot carry instructions;
   - is not labelled `needs-owner`;
   - cites a file outside the off-limits list (the `PROTECTED` list plus the issue 999 files and migrations);
   - names a source PR whose title carries a unit.

   The unit gives the branch (`unit/U-xxx-nightly-<issue>`), the PR title, and so the tier. The night is skipped while any nightly fix PR is still open.
2. **fix** (Claude Code, Sonnet, 60 turns, 30 minutes):
   - **Inputs:** the prompt `scripts/nightly-fix/fix-prompt.md`, with the ticket as data and a scope manifest built from it.
   - **Tools:** read, edit, the pnpm gates and `git diff`; nothing that reaches the network or GitHub. The job holds no GitHub credential.
   - **Output:** the agent writes a test that fails first, then the fix, and runs the gates. The workflow runs the gates again and saves the change as a patch.
3. **publish** (a fresh runner the agent never touched):
   - applies the patch;
   - runs `guard.ts`, which refuses off-limits files and more than 6 files or 300 changed lines;
   - commits as the App, then pushes, opens the PR with `Closes #n`, and requests Dave's review through `agent-git.ts`.
4. **check** (three Claude Code runs in parallel, read-only tools): `review-agent`, `spec-compliance` and `architecture-audit`, each from `scripts/nightly-fix/check-prompt.md`. Each run reads the ticket, the diff, the repo rules and `ramble-pm/drafts/wave3-review-rules.md`.
5. **post** (another fresh runner): posts the three verdicts with `post-check.ts`. PASS becomes success and FAIL becomes failure. No verdict becomes `action_required`, which holds the merge.

**v1 limits, on purpose:**
- The workflow never posts `qa-agent` and never queues auto-merge. Every PR waits for the lead PM's qa round and, for critical tier, Dave's read.
- A FAIL is not retried overnight; the lead PM takes the next round.

## Security

- **Only fresh runners hold the App key.** The key is written only in `publish` and `post`, where the agent never ran, so hooks, git config, or background processes the agent left on its own runner cannot reach it.
- **The Anthropic key is exposed to the agent's test runs.** `pnpm test` runs code the agent wrote, in the step that holds `ANTHROPIC_API_KEY`. Use a dedicated key in its own Anthropic workspace with a monthly spend limit, not a personal key.
- **The ticket is data.** It comes only from the App's own tickets, and the prompt tells the agent to act on the described defect and nothing else.
- **The workflow file itself is protected.** It sits under `.github/`, so changing it is a bypass merge for Dave, like any rules change.

## Cost

Assumes Sonnet: about $2 to $6 for the fix and $1 to $3 for the three checks, so under $10 a night. On a skipped night the cost is only the `pick` job's runner minutes. The `token-audit` tool cannot see these runs, so the agent review reads `total_cost_usd` from each job's log instead.

## What Dave does

1. **Accept or change this ADR.** On acceptance, the PR adding it and the workflow is a bypass merge (it changes `.github/` and `docs/adr/`).
2. **Repository secrets:** `ANTHROPIC_API_KEY` (dedicated, spend-capped), plus `RAMBLE_APP_ID`, `RAMBLE_APP_INSTALLATION_ID` and `RAMBLE_APP_PRIVATE_KEY` (the same values as `~/.config/ramble-agents/app.conf`).
3. **Repository variable:** `CLAUDE_CODE_VERSION`, set to an exact version, so the workflow does not float.
4. **Create the `nightly-fix` label** and put it on one ticket. Then dispatch the workflow by hand once and read every step before leaving it on the schedule.

## Open questions

- **Agent definitions:** the checks run from a prompt in this repo, not from the global `review`, `spec-compliance` and `architecture-audit` agents in vig, which live on Dave's Mac. Their verdicts may differ in strictness. The agent review can compare them against local reruns of the same PRs.
- **When to go further:** posting `qa-agent` from the runner (Playwright and a seeded build are possible there) and queuing auto-merge for standard tier, after about two weeks of clean nights.
- **Should the picker read the board's Sprint field?** It reads labels only for now. Labels are what the App can reach without a project-scoped token.

## What would change the call

- If Claude Code cloud tasks gain a way to act as a named GitHub App, option B becomes simpler.
- If a nightly PR ever passes its checks with a wrong fix, the label stays off until the checks are tightened.
