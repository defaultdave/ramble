#!/usr/bin/env bash
# Dave only: opens or closes the approval window on both rulesets (DECISIONS 2026-10-21).
#   on:  every PR into main or integration needs 1 approval, dismissed when new commits land
#   off: back to 0 approvals; the four required checks alone merge a PR
# Usage: scripts/merge-desk/approval-window.sh on|off   (needs Dave's gh login; the App cannot change rulesets)
set -euo pipefail
case "${1:-}" in
  on) count=1 dismiss=true ;;
  off) count=0 dismiss=false ;;
  *) echo "usage: $0 on|off" >&2; exit 1 ;;
esac
for id in 25513279 25513280; do
  gh api "repos/defaultdave/ramble/rulesets/$id" |
    jq --argjson count "$count" --argjson dismiss "$dismiss" '{name, target, enforcement, conditions, bypass_actors,
      rules: [.rules[] | if .type == "pull_request"
        then .parameters.required_approving_review_count = $count | .parameters.dismiss_stale_reviews_on_push = $dismiss
        else . end]}' |
    gh api -X PUT "repos/defaultdave/ramble/rulesets/$id" --input - \
      -q '.name + ": approvals " + (.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count | tostring)'
done
