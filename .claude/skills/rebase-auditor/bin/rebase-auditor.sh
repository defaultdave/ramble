#!/usr/bin/env bash
# rebase-auditor: surface silent deletions after a rebase.
# Exit codes: 0 = clean, 1 = deletions need review, 2 = error
#
# Compatible with bash 3.2+ (macOS default).

set -euo pipefail

DEFAULT_REF="refs/rebase-auditor/pre-rebase"

# ── helpers ──────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 2; }

require_git() {
  git rev-parse --git-dir > /dev/null 2>&1 || die "Not inside a git repository."
}

resolve_ref() {
  git rev-parse --verify "$1" 2>/dev/null || die "Cannot resolve ref: $1"
}

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <command> [options]

Commands:
  snapshot    Save current HEAD as the pre-rebase reference
  audit       Compare pre-rebase ref to post-rebase ref, report deletions

Options for snapshot:
  --ref <ref>        Git ref to write  (default: $DEFAULT_REF)

Options for audit:
  --pre <sha|ref>    Pre-rebase reference  (default: $DEFAULT_REF)
  --post <sha|ref>   Post-rebase reference (default: HEAD)
  --json             Emit machine-readable JSON to stdout (human report → stderr)

Exit codes: 0 no concerning deletions · 1 deletions need review · 2 error
EOF
}

# ── snapshot ─────────────────────────────────────────────────────────────────

cmd_snapshot() {
  local ref="$DEFAULT_REF"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ref) ref="$2"; shift 2 ;;
      *)     die "Unknown option: $1" ;;
    esac
  done

  require_git
  local sha
  sha=$(git rev-parse HEAD)
  git update-ref "$ref" "$sha"
  echo "Snapshot saved: $ref → $sha" >&2
}

# ── audit ─────────────────────────────────────────────────────────────────────

cmd_audit() {
  local pre_ref="$DEFAULT_REF"
  local post_ref="HEAD"
  local json_out=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pre)  pre_ref="$2";  shift 2 ;;
      --post) post_ref="$2"; shift 2 ;;
      --json) json_out="1";  shift   ;;
      *)      die "Unknown option: $1" ;;
    esac
  done

  require_git

  local pre_sha post_sha
  pre_sha=$(resolve_ref "$pre_ref")   || exit 2
  post_sha=$(resolve_ref "$post_ref") || exit 2

  if [[ "$pre_sha" == "$post_sha" ]]; then
    echo "Pre and post refs are identical — nothing to audit." >&2
    [[ -n "$json_out" ]] && \
      echo "{\"pre\":\"$pre_sha\",\"post\":\"$post_sha\",\"concerning\":[],\"refactor\":[],\"summary\":{\"concerning_count\":0,\"refactor_count\":0}}"
    exit 0
  fi

  # Temp files (cleaned up on exit)
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  local added_file="$tmpdir/added.txt"
  local concerning_file="$tmpdir/concerning.tsv"   # file<TAB>line
  local refactor_file="$tmpdir/refactor.tsv"       # file<TAB>line

  touch "$added_file" "$concerning_file" "$refactor_file"

  # Collect all added lines (normalized) from the full diff — used for classification.
  git diff "$pre_sha" "$post_sha" -- \
    | grep '^+' | grep -v '^+++' \
    | sed 's/^+//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//' \
    > "$added_file"

  # Parse the diff line-by-line, tracking current file and classifying removals.
  local current_file=""
  while IFS= read -r raw_line; do
    # Detect file header: --- a/path/to/file
    if [[ "$raw_line" =~ ^---[[:space:]]a/(.+)$ ]]; then
      current_file="${BASH_REMATCH[1]}"
      continue
    fi

    # Skip if no current file context yet
    [[ -z "$current_file" ]] && continue

    # Only process removed lines (start with '-', not '---')
    [[ "$raw_line" =~ ^\-[^\-] ]] || continue

    # Normalize: strip leading '-' and surrounding whitespace
    local removed_line
    removed_line=$(printf '%s' "${raw_line:1}" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

    # Skip blank lines — not meaningful signal
    [[ -z "$removed_line" ]] && continue

    # Classify: if the exact line appears in additions, it's a likely refactor
    if grep -qxF "$removed_line" "$added_file" 2>/dev/null; then
      printf '%s\t%s\n' "$current_file" "$removed_line" >> "$refactor_file"
    else
      printf '%s\t%s\n' "$current_file" "$removed_line" >> "$concerning_file"
    fi
  done < <(git diff --unified=3 "$pre_sha" "$post_sha" --)

  local concerning_count refactor_count
  concerning_count=$(wc -l < "$concerning_file" | tr -d ' ')
  refactor_count=$(wc -l < "$refactor_file" | tr -d ' ')

  # ── human-readable report (stderr) ───────────────────────────────────────

  {
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║              rebase-auditor report                   ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo "  pre:  $pre_sha ($pre_ref)"
    echo "  post: $post_sha ($post_ref)"
    echo ""
    echo "  Concerning deletions (no matching addition): $concerning_count"
    echo "  Likely-refactor deletions (matched addition): $refactor_count"
    echo ""

    if (( concerning_count > 0 )); then
      echo "━━━ CONCERNING DELETIONS (need human review) ━━━━━━━━━"
      local prev_file=""
      while IFS=$'\t' read -r file_col line_col; do
        if [[ "$file_col" != "$prev_file" ]]; then
          echo ""
          echo "  File: $file_col"
          prev_file="$file_col"
        fi
        echo "    - $line_col"
      done < <(sort "$concerning_file")
      echo ""
    fi

    if (( refactor_count > 0 )); then
      echo "━━━ LIKELY-REFACTOR DELETIONS (de-emphasized) ━━━━━━━━"
      local prev_file=""
      while IFS=$'\t' read -r file_col line_col; do
        if [[ "$file_col" != "$prev_file" ]]; then
          echo ""
          echo "  File: $file_col"
          prev_file="$file_col"
        fi
        echo "    ~ $line_col"
      done < <(sort "$refactor_file")
      echo ""
    fi

    if (( concerning_count == 0 && refactor_count == 0 )); then
      echo "  No deletions detected. Rebase looks clean."
      echo ""
    fi
  } >&2

  # ── JSON output (stdout, only when --json) ────────────────────────────────

  if [[ -n "$json_out" ]]; then
    local concerning_json="["
    local first=1
    while IFS=$'\t' read -r file_col line_col; do
      [[ $first -eq 0 ]] && concerning_json+=","
      local ef el
      ef=$(printf '%s' "$file_col" | sed 's/"/\\"/g')
      el=$(printf '%s' "$line_col" | sed 's/"/\\"/g')
      concerning_json+="{\"file\":\"$ef\",\"line\":\"$el\"}"
      first=0
    done < "$concerning_file"
    concerning_json+="]"

    local refactor_json="["
    first=1
    while IFS=$'\t' read -r file_col line_col; do
      [[ $first -eq 0 ]] && refactor_json+=","
      local ef el
      ef=$(printf '%s' "$file_col" | sed 's/"/\\"/g')
      el=$(printf '%s' "$line_col" | sed 's/"/\\"/g')
      refactor_json+="{\"file\":\"$ef\",\"line\":\"$el\"}"
      first=0
    done < "$refactor_file"
    refactor_json+="]"

    echo "{\"pre\":\"$pre_sha\",\"post\":\"$post_sha\",\"concerning\":$concerning_json,\"refactor\":$refactor_json,\"summary\":{\"concerning_count\":$concerning_count,\"refactor_count\":$refactor_count}}"
  fi

  # ── exit code ─────────────────────────────────────────────────────────────

  if (( concerning_count > 0 )); then
    exit 1
  fi
  exit 0
}

# ── dispatch ──────────────────────────────────────────────────────────────────

[[ $# -eq 0 ]] && { usage; exit 2; }

COMMAND="$1"; shift
case "$COMMAND" in
  snapshot) cmd_snapshot "$@" ;;
  audit)    cmd_audit    "$@" ;;
  help|-h|--help) usage; exit 0 ;;
  *) die "Unknown command: $COMMAND. Run with 'help' for usage." ;;
esac
