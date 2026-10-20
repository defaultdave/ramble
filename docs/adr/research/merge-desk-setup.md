---
title: Merge desk and agent identity, setup notes for the tiered auto-merge rule
date: 2026-10-20
status: design agreed with Dave in chat; runbook and unit not written yet
amends: ADR 0010 (Merge rule for the P5 build)
---

# Merge desk setup notes

Decision of record: `DECISIONS.md` 2026-10-20 and ADR 0010 "Merge rule for the P5 build". These notes are the design the runbook must implement.

## Why not PR approvals

GitHub never lets an account approve a PR it authored. Agents push with Dave's `gh` login, so an approval from that identity cannot count. The review verdict is therefore a **required status check**, not a PR approval, and the rules require **0 human approvals**.

## Design

1. **Rules (rulesets) on `main` and `integration`:** require a PR; require status checks (CI; `review-agent`; `qa-agent`; `spec-compliance`; scope-manifest check); block direct pushes; 0 required approvals; Dave alone on the bypass list. Repo goes public at the plan freeze (free rulesets, CodeQL, push protection, Actions minutes; DECISIONS 2026-10-18).
2. **Merge desk = GitHub auto-merge:** the unit's agent runs `gh pr merge --auto --squash`; GitHub merges when the required checks pass. No model is needed for the merge itself.
3. **Agent identity = a GitHub App**, not a second user account. Permissions: contents, pull requests, checks, statuses (write). No admin, no workflow edits, no secrets, not on the bypass list. Agents authenticate with an installation token. This keeps agents from promoting `integration` to `main`, which only Dave does.
4. **Two tiers:** `review: standard` units PR into `main`; `review: critical` units PR into `integration`. Promotion `integration` to `main` is a PR only Dave merges, after the nightly smoke test and the overnight race and access tests are green.
5. **Revert path:** one documented command reverts a merge (a revert PR through the same checks, plus a faster break-glass for Dave).
6. **Nightly smoke test** on `main` and `integration`, results to a status the promotion PR requires.

## Where the model calls run (cost)

GitHub supplies free orchestration and compute; the review and QA agents are still model calls.

| Option | Cost | Notes |
|---|---|---|
| Local Claude Code sessions on Dave's subscription post verdicts as check runs through the App | no API bill | Dave's machine must be awake overnight |
| GitHub Actions with Claude Code Action on a subscription token | no API bill | Check Anthropic's terms for subscription tokens in CI before relying on it |
| Actions with an API key | metered | Cleanest unattended; keep it small with Haiku-tier narrow checks |

Start with local sessions; move the cheap narrow checks to Actions later.

## Open items for the runbook

- Which `units.yaml` unit owns this. The breakdown has no unit for the App, the rulesets, the check workflows, the revert command, or the nightly smoke test; ADR 0010 only says "port the vig merge desk as its own unit". Add one (Dave leads, Foundation, before the first fan-out unit merges) and re-run the estimate for it.
- `CLAUDE.md` and `.claude/agents/ramble-pm.md` hard lines still say no merges without Dave. Change them only when the rules, the App, and the checks exist and Dave switches auto-merge on.
- Dave relaxes the permission prompts for `git push`, `gh pr create`, and `gh pr merge` for this project.
- Branch protection on a private repo needs a paid plan; the repo goes public at the plan freeze.
