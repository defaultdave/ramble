---
name: rebase-auditor
description: Use this skill after any rebase operation to check for silent deletions. Takes a pre-rebase snapshot and compares it to the post-rebase state, surfacing lines that were removed with no corresponding addition elsewhere. Run it before merging any rebased branch. Trigger on phrases like "audit the rebase", "check for silent deletions", "snapshot before rebase", or when pr-manager completes a rebase.
---

# rebase-auditor

Catches the specific failure mode where an agent silently removes previously-merged code during a rebase — deleting lines it decides are extraneous, with no corresponding addition. Asymmetric by design: false positives are acceptable; false negatives are the failure we're preventing.

## Two-step workflow

### Step 1: Snapshot (run before the rebase)

```bash
$CLAUDE_PROJECT_DIR/.claude/skills/rebase-auditor/bin/rebase-auditor.sh snapshot
```

Saves current HEAD to `refs/rebase-auditor/pre-rebase`. This ref is not a branch — it won't show in `git branch`, won't be pushed, and won't interfere with the user's stash stack.

Run this before `git rebase`, `git rebase --onto`, or any automated rebase triggered by the pipeline.

### Step 2: Audit (run after the rebase)

```bash
$CLAUDE_PROJECT_DIR/.claude/skills/rebase-auditor/bin/rebase-auditor.sh audit
```

Compares `refs/rebase-auditor/pre-rebase` to `HEAD`. Produces:

- Human-readable summary: counts by category (concerning vs. likely-refactor)
- Per-file detail: the specific removed lines with surrounding context
- `--json` flag: machine-readable sidecar for downstream skills

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No concerning deletions |
| 1 | Deletions found that need human review |
| 2 | Error running the check |

Pre-commit hooks and CI should gate on exit code. `pr-manager` must not mark a rebase complete when exit code is 1.

## Invocation reference

```bash
# Snapshot (before rebase) — custom ref
$CLAUDE_PROJECT_DIR/.claude/skills/rebase-auditor/bin/rebase-auditor.sh snapshot [--ref <git-ref>]

# Audit (after rebase) — override refs
$CLAUDE_PROJECT_DIR/.claude/skills/rebase-auditor/bin/rebase-auditor.sh audit [--pre <sha|ref>] [--post <sha|ref>] [--json]
```

## Integration points

**pr-manager:** Call `snapshot` before every within-stack rebase. Call `audit` after. Refuse to mark the rebase complete if audit exits 1.

**CI job:** Add as a step that runs `audit --pre <pre-rebase-sha> --post HEAD --json`. Gate on exit code. The JSON output can be posted as a PR annotation.

**Pre-commit hook:** Run `audit` if `refs/rebase-auditor/pre-rebase` exists. This catches rebases done manually by developers.

## Categories

**Concerning deletions** — lines removed with no corresponding addition anywhere in the diff. These are the false-negative risk: something real was erased.

**Likely-refactor deletions** — lines removed where the same content (or a close match) appears as an addition elsewhere. De-emphasized in the report but still present; some of these may still need review.

The heuristic uses exact-match first, then normalized whitespace. It does not use semantic similarity — this keeps the script fast and the classification auditable.

## What this skill does NOT do

- Rebase anything. It reads; it does not write.
- Evaluate whether a deletion is semantically correct. It flags; humans judge.
- Compare against PRs or branches other than the two explicit refs. Point it at what you want compared.
- Run tests or quality gates. Those are in `quality-gates.md`.
- Detect additions of new bugs or regressions. Different problem.

## When to skip it

- The diff between pre and post contains only your changes and zero merged-in code (i.e., a first rebase of a fresh branch onto main with no prior merges). The silent-deletion risk only exists when previously-merged code is in the lineage.
- `refs/rebase-auditor/pre-rebase` doesn't exist and no `--pre` ref is provided — the script exits 2 (error), not 0 (clean). Don't treat a missing snapshot as a pass.
