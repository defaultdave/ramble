#!/usr/bin/env bash
# Opens a revert PR for a merged PR; it runs the same required checks and auto-merges.
# Usage: scripts/merge-desk/revert.sh <pr-number>   (unit PRs only; a promotion is reverted by Dave, runbook F2)
set -euo pipefail
pr="$1"
base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
sha=$(gh pr view "$pr" --json mergeCommit -q .mergeCommit.oid)
title=$(gh pr view "$pr" --json title -q .title)
branch="revert/pr-$pr"
# A promotion lands as a merge commit. Its revert title has no unit ID, so scope-manifest would never pass it.
if [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" -gt 2 ]; then
  echo "PR $pr is a promotion (merge commit). Auto-merge cannot revert it: Dave reverts it with break-glass (runbook F2)." >&2
  exit 1
fi
git fetch origin "$base"
git switch -c "$branch" "origin/$base"
git revert --no-edit "$sha"
body=$(mktemp)
printf 'Reverts #%s (merge commit %s).\n' "$pr" "$sha" > "$body"
bun scripts/merge-desk/agent-git.ts push "$branch"
bun scripts/merge-desk/agent-git.ts pr "$base" "Revert: $title" "$body"
bun scripts/merge-desk/agent-git.ts automerge "$branch"
# Auto-merge is only queued. The revert merges after review-agent, qa-agent, spec-compliance, and architecture-audit are posted
# for this head sha (post-check.ts); this script does not run those reviewers.
echo "Revert PR queued on $(git rev-parse HEAD). Post the four agent checks for that sha to let it merge." >&2
