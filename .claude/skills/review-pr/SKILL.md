---
name: review-pr
description: Runs Stage 5 (review + qa + enabled specialists) against an existing PR. Default output is verdict files in the worktree; pass --pr to post to GitHub.
disable-model-invocation: true
argument-hint: <pr-url> [--pr]
---

# Review-PR

Runs **only** Stage 5 of the pipeline — review + qa + every enabled specialist — against an **existing PR**. No Assess, Implement, Verify, or Push. No squad registration. Works in any repo: the Dispatcher is used only when the target project has one.

**Default output mode is file**, inverting `/team`'s default. Pass `--pr` to post verdicts as PR comments and update issue checkboxes.

## When to use this

- You (or a benchmark / team-sitter) already opened a PR and want fresh verdicts without spamming GitHub.
- You want to dry-run agent changes (e.g. after editing `review.md`) against a real PR before letting them comment.
- You're auditing an external PR that the pipeline didn't produce.

For "build from scratch → review", use `/team`. For "push a worktree that's already been reviewed locally", use `/foreman push`.

## Argument parsing

```bash
PR_URL=""
OUTPUT_MODE="file"   # default; --pr inverts

for arg in "$@"; do
  case "$arg" in
    --pr)     OUTPUT_MODE="pr" ;;
    --no-pr)  OUTPUT_MODE="file" ;;    # accepted for symmetry with /team, but it's already the default
    --file)   OUTPUT_MODE="file" ;;
    https://github.com/*/pull/*) PR_URL="$arg" ;;
    *) echo "review-pr: unknown arg '$arg'" >&2; exit 2 ;;
  esac
done
[[ -n "$PR_URL" ]] || { echo "usage: /review-pr <pr-url> [--pr]" >&2; exit 2; }

# Parse URL → owner, repo, number.
PR_OWNER=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\1|')
PR_REPO_NAME=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\2|')
PR_NUMBER=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\3|')
PR_REPO="${PR_OWNER}/${PR_REPO_NAME}"

echo "review-pr: $PR_REPO#$PR_NUMBER  mode=$OUTPUT_MODE"
```

## Stage R1 — Inspect PR

```bash
PR_JSON=$(gh pr view "$PR_NUMBER" -R "$PR_REPO" \
  --json number,title,state,headRefName,headRefOid,baseRefName,url,body,isDraft,mergeable,changedFiles)

PR_HEAD_BRANCH=$(echo "$PR_JSON" | jq -r '.headRefName')
PR_HEAD_OID=$(echo "$PR_JSON" | jq -r '.headRefOid')
PR_BASE_BRANCH=$(echo "$PR_JSON" | jq -r '.baseRefName')   # may be a feature branch, not main, for stacked PRs
PR_STATE=$(echo "$PR_JSON" | jq -r '.state')
PR_BODY=$(echo "$PR_JSON" | jq -r '.body')
PR_TITLE=$(echo "$PR_JSON" | jq -r '.title')

[[ "$PR_STATE" == "OPEN" ]] || { echo "review-pr: PR is $PR_STATE — expected OPEN" >&2; exit 1; }

# Find the linked issue via `Closes #N` (first match).
ISSUE_N=$(echo "$PR_BODY" | grep -oiE '(closes|fixes|resolves)[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
```

## Stage R2 — Resolve worktree

Reuse an existing worktree already on the PR's head branch. Otherwise create a fresh one under `.claude/worktrees/review-only/`.

```bash
# Search all worktrees on any repo for one matching this head branch.
WORKING_DIR=""
while read -r wt_path _ wt_branch; do
  branch=$(echo "$wt_branch" | tr -d '[]')
  if [[ "$branch" == "$PR_HEAD_BRANCH" ]]; then
    WORKING_DIR="$wt_path"
    break
  fi
done < <(git worktree list 2>/dev/null)

# The current project counts as a clone when its origin is the PR's repo.
# In a cloud session it is the only clone there is.
PROJECT_CLONE=""
if [[ -n "$CLAUDE_PROJECT_DIR" ]] && git -C "$CLAUDE_PROJECT_DIR" remote get-url origin 2>/dev/null | grep -qiF "$PR_REPO"; then
  PROJECT_CLONE="$CLAUDE_PROJECT_DIR"
fi

# Also check worktree lists in any known clone of the target repo.
if [[ -z "$WORKING_DIR" ]]; then
  for clone in ${PROJECT_CLONE:+"$PROJECT_CLONE"} "$HOME/Workspace/$PR_REPO_NAME" "/workspace/$PR_REPO_NAME"; do
    [[ -d "$clone" ]] || continue
    while read -r wt_path _ wt_branch; do
      branch=$(echo "$wt_branch" | tr -d '[]')
      if [[ "$branch" == "$PR_HEAD_BRANCH" ]]; then
        WORKING_DIR="$wt_path"
        break 2
      fi
    done < <(git -C "$clone" worktree list 2>/dev/null)
  done
fi

# No existing worktree — create one. Requires a local clone of the target repo.
if [[ -z "$WORKING_DIR" ]]; then
  CLONE=""
  for candidate in ${PROJECT_CLONE:+"$PROJECT_CLONE"} "$HOME/Workspace/$PR_REPO_NAME" "/workspace/$PR_REPO_NAME"; do
    [[ -d "$candidate/.git" ]] && { CLONE="$candidate"; break; }
  done
  [[ -n "$CLONE" ]] || { echo "review-pr: no local clone of $PR_REPO found; clone it first" >&2; exit 1; }

  git -C "$CLONE" fetch origin "$PR_HEAD_BRANCH:$PR_HEAD_BRANCH" 2>&1 | tail -3
  WORKING_DIR="$CLAUDE_PROJECT_DIR/.claude/worktrees/review-only/pr-${PR_NUMBER}-$(date -u +%s)"
  git -C "$CLONE" worktree add "$WORKING_DIR" "$PR_HEAD_BRANCH"
  [[ -f "$WORKING_DIR/package.json" ]] && (cd "$WORKING_DIR" && npm install 2>&1 | tail -3)
fi

echo "review-pr: WORKING_DIR=$WORKING_DIR"

# Verify worktree matches PR head OID.
LOCAL_HEAD=$(git -C "$WORKING_DIR" rev-parse HEAD)
if [[ "$LOCAL_HEAD" != "$PR_HEAD_OID" ]]; then
  echo "review-pr: WARNING local head ($LOCAL_HEAD) != PR head ($PR_HEAD_OID). Reviewing local state." >&2
fi

# Prep verdict drop directory.
VERDICT_DIR="$WORKING_DIR/.team-verdicts"
mkdir -p "$VERDICT_DIR"
```

## Stage R3 — Scope manifest

Pull the scope manifest from the linked issue if found. Otherwise fall back to the PR's changed-file list and warn.

```bash
SCOPE_MANIFEST=""
IN_SCOPE_GLOBS=""
ACCEPTANCE_CRITERIA=""

if [[ -n "$ISSUE_N" ]]; then
  ISSUE_BODY=$(gh issue view "$ISSUE_N" -R "$PR_REPO" --json body -q '.body' 2>/dev/null || true)
  if [[ -n "$ISSUE_BODY" ]]; then
    # Extract the "## SCOPE MANIFEST" section or an `in_scope_globs:` yaml block.
    SCOPE_MANIFEST=$(echo "$ISSUE_BODY" | awk '/^## SCOPE MANIFEST/,/^## [^S]/' | sed '$d')
    IN_SCOPE_GLOBS=$(echo "$ISSUE_BODY" | awk '/^in_scope_globs:/,/^[^ -]/' | sed '$d')
    # Checkbox lines under "## Acceptance Criteria", up to the next heading.
    ACCEPTANCE_CRITERIA=$(echo "$ISSUE_BODY" | awk '/^## Acceptance Criteria/{f=1;next} /^## /{f=0} f && /^- \[[ x]\]/')
    [[ -n "$SCOPE_MANIFEST" ]] && cat > "$WORKING_DIR/.team-scope-manifest" <<<"$SCOPE_MANIFEST"
  fi
fi

if [[ -z "$SCOPE_MANIFEST" ]]; then
  echo "review-pr: no scope manifest found (issue #${ISSUE_N:-?} missing or has no manifest)." >&2
  echo "review-pr: review agent will skip scope audit; diff files used as de-facto scope." >&2
  CHANGED_FILES=$(gh pr diff "$PR_NUMBER" -R "$PR_REPO" --name-only 2>/dev/null || \
                  git -C "$WORKING_DIR" diff --name-only "${PR_BASE_BRANCH:-main}...HEAD")
fi
```

## Stage R4 — Stage 5 fan-out (parallel)

Same shape as `/team` Stage 5 but with a **synthetic squad_id** (no squad registration, since there's no squad).

```bash
SQUAD_ID="review-pr-${PR_NUMBER}-$(date -u +%s)"
PORT_BASE=3000   # no port reservation for review-only; provide a default in case QA needs one

# The Dispatcher is optional: only projects running the vig Office have one.
DISPATCHER=$CLAUDE_PROJECT_DIR/.claude/office/bin/dispatcher.sh
[[ -x "$DISPATCHER" ]] || DISPATCHER=""

# Enabled specialists: the target project's list, else this skill's bundled default.
SPECIALISTS_FILE=$CLAUDE_PROJECT_DIR/.claude/office/specialists-enabled.txt
[[ -f "$SPECIALISTS_FILE" ]] || SPECIALISTS_FILE=$CLAUDE_PROJECT_DIR/.claude/skills/review-pr/specialists-enabled.txt
ENABLED_SPECIALISTS=()
if [[ -f "$SPECIALISTS_FILE" ]]; then
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    case "$line" in
      spec-compliance|a11y-audit|perf-check|architecture-audit) ENABLED_SPECIALISTS+=("$line") ;;
      *) echo "review-pr: ignoring unknown specialist '$line'" >&2 ;;
    esac
  done < "$SPECIALISTS_FILE"
fi

# Capacity reservation runs only when a Dispatcher exists. On a cap it releases
# prior reservations and stops with LOOP_CONTINUE so a loop caller retries next cycle.
declare -A RUN_IDS
reserve_or_wait() {
  [[ -n "$DISPATCHER" ]] || return 0
  local agent="$1"
  if ! $DISPATCHER can-spawn-agent "$SQUAD_ID"; then
    for prior in "${!RUN_IDS[@]}"; do $DISPATCHER release-agent "${RUN_IDS[$prior]}" 0 budget_cap >/dev/null; done
    echo "LOOP_CONTINUE reason=dispatcher_cap_on=$agent"; exit 0
  fi
  RUN_IDS["$agent"]=$($DISPATCHER reserve-agent "$SQUAD_ID" "$agent" | grep '^RUN_ID=' | cut -d= -f2)
}
reserve_or_wait review
[[ "$SKIP_QA" != "true" ]] && reserve_or_wait qa
for s in "${ENABLED_SPECIALISTS[@]}"; do reserve_or_wait "$s"; done
```

**Spawning** — issue all Agent-tool calls in a single message so they run in parallel. Each prompt MUST include:

- Task description (synthesized from PR title + body).
- Scope manifest text (or the "no manifest — scope audit disabled; here are the changed files" fallback block).
- `WORKING_DIR` absolute path.
- **Output target block** — exactly one of:

```
# OUTPUT_MODE=pr
PR_NUMBER=<N>
PR_REPO=<owner/repo>
Post verdict as a PR comment; update your owned issue checkbox.
```

```
# OUTPUT_MODE=file  (default)
--output-file <WORKING_DIR>/.team-verdicts/<agent>.md

The verdict file is the only output target; PR comments and issue checkboxes are published later by `/foreman push` (see agent-output-target.md).
For qa screenshots: save to <WORKING_DIR>/.team-verdicts/screenshots/ with relative paths.
Still emit machine-readable verdict lines on stdout.
At the end of your run, print:
  WROTE=<path>
  COMMENTED_ON_PR=no
```

- Agent-specific extras:
  - **qa** — `PORT=$((PORT_BASE + (ISSUE_N % 100)))` suggested (issue may be null; use `3000` then). Include routes/pages to verify from PR body or issue ACs.
  - **review** — include `git -C <WORKING_DIR> diff "${PR_BASE_BRANCH}...HEAD"` as the review target (use the PR's actual base — it may be a feature branch, not `main`), the list of changed files, and `$ACCEPTANCE_CRITERIA` under an `## Acceptance Criteria` heading (omit the heading when it is empty).
  - **specialists** — same task description + scope manifest; each owns its own output contract.

**Release** after all agents return (no-op without a Dispatcher):

```bash
for agent in "${!RUN_IDS[@]}"; do
  [[ -n "$DISPATCHER" ]] && $DISPATCHER release-agent "${RUN_IDS[$agent]}" "${AGENT_TOKENS[$agent]:-20000}" ok
done
```

(No `release-squad` — we didn't register one.)

## Stage R5 — Aggregate & report

Parse stdout from each agent for its verdict keys. Apply the same bundling rule as `/team` Stage 5: all positive → done; any negative → do NOT re-dispatch senior automatically (this command doesn't own implementation); print the aggregated negative feedback and stop.

**Completion criteria (same as `/team`):**
- `REVIEW_VERDICT` → APPROVE or APPROVE_WITH_NITS
- `QA_VERDICT` → PASS
- every enabled specialist `*_VERDICT` → APPROVE (a short-circuited APPROVE counts)

**Summary output** — print to stdout, no files written at this stage beyond what the agents already wrote:

```
review-pr summary — $PR_REPO#$PR_NUMBER (mode=$OUTPUT_MODE)
  Review:         APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES
  QA:             PASS | FAIL | BLOCKED
  <each enabled specialist>: APPROVE | REQUEST_CHANGES
  Verdict files:  $WORKING_DIR/.team-verdicts/
  Overall:        PASS | FAIL
```

In `--pr` mode, additionally confirm:
- Review comment posted: `gh pr view <N> -R <repo> --json comments -q '.comments | length'` increased.
- Review's "Code review: APPROVE" and QA's "QA: PASS" issue checkboxes updated (if APPROVE + PASS).

In file mode (default), additionally print the file-mode sanity check — run **before** summary:

```bash
POST_COUNT=$(gh pr view "$PR_NUMBER" -R "$PR_REPO" --json comments -q '.comments | length')
if [[ "$POST_COUNT" != "$PRE_COUNT" ]]; then
  echo "review-pr: WARNING PR comment count changed ($PRE_COUNT → $POST_COUNT) in file mode" >&2
fi
```

(Capture `PRE_COUNT` once at the top of Stage R1 before anything runs.)

## What this command does NOT do

- **No Assess / Implement / Verify / Push** — there's no senior agent spawned, no worktree built from `main`, no commits.
- **No squad registration** — when the target project has a Dispatcher, the synthetic `squad_id` keeps capacity gating working without touching the squads table; without one, agents spawn directly.
- **No automatic re-dispatch on negative verdicts.** If review or qa says REQUEST_CHANGES / FAIL, the command reports it and stops. Fixing is on the human (or a follow-up `/team`).
- **No worktree cleanup.** The worktree stays under `.claude/worktrees/review-only/pr-<N>-<ts>/` (or wherever it was reused from). Remove manually with `git worktree remove` when done.
- **No PR merge.** Same rule as `/team` — never merges to main.

## Related

- `/team` — full pipeline (Assess → Implement → Verify → Push → Stage 5)
- `/review-swarm <pr-url>` — the cheaper static alternative: narrow haiku reviewers with a verify pass, no QA, one verdict file
- `/foreman push <squad-id>` — publish a `/team` run that has been reviewed locally
- [`agent-output-target.md`](../../docs/agent-output-target.md) — the PR-vs-file protocol the Stage 5 agents key off
