#!/usr/bin/env bash
# Opens a revert PR for a merged PR; it runs the same required checks and auto-merges.
# Usage: scripts/merge-desk/revert.sh <pr-number>
set -euo pipefail
pr="$1"
base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
sha=$(gh pr view "$pr" --json mergeCommit -q .mergeCommit.oid)
title=$(gh pr view "$pr" --json title -q .title)
branch="revert/pr-$pr"
git fetch origin "$base"
git switch -c "$branch" "origin/$base"
# A promotion lands as a merge commit; unit PRs land squashed.
if [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" -gt 2 ]; then
  git revert --no-edit -m 1 "$sha"
else
  git revert --no-edit "$sha"
fi
body=$(mktemp)
printf 'Reverts #%s (merge commit %s).\n' "$pr" "$sha" > "$body"
bun scripts/merge-desk/agent-git.ts push "$branch"
bun scripts/merge-desk/agent-git.ts pr "$base" "Revert: $title" "$body"
bun scripts/merge-desk/agent-git.ts automerge "$branch"
