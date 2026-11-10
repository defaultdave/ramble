---
name: senior
description: Implement one ticket end to end in an isolated worktree. Resolves the ticket, creates a worktree and branch, writes a scope manifest, runs the senior agent and the quality gates, and stops before push.
disable-model-invocation: true
argument-hint: <issue-url | #N | TICKET-KEY | free text> [--base <branch>]
---

# /senior — one ticket, one agent, one worktree

The lightweight implementation entry point. It does what an engineer does for a single ticket: read it, branch, build, test, and stop where pushing becomes a decision. No squad registration, no Dispatcher, no pipeline chain. Run `/review-pr` afterwards for an independent review, or use `/team` (inside vig) when the full pipeline is wanted.

## 1. Resolve the ticket

`ARG` is everything after `/senior`, minus `--base <branch>` when present.

| Shape of `ARG` | Source | Sets |
|---|---|---|
| `https://github.com/<owner>/<repo>/issues/<N>`, `#N`, or bare digits | `gh issue view "$N" -R "$OWNER/$REPO" --json number,title,body,labels` (repo from the URL, else `gh repo view --json nameWithOwner`) | `TICKET_ID=N`, `TITLE`, `BODY` |
| `^[A-Z][A-Z0-9]+-[0-9]+$` (Jira key) | An issue-read tool from a Jira MCP server, if this session has one. If it does not, say so in one line and ask the user to paste the ticket text. | `TICKET_ID=KEY`, `TITLE`, `BODY` |
| anything else | The text itself is the task | `TICKET_ID` empty, `TITLE` = first line, `BODY` = full text |

## 2. Branch and worktree

```bash
BASE="${BASE:-main}"
SLUG=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-40 | sed 's/-$//')
BRANCH="senior/${TICKET_ID:+$TICKET_ID-}${SLUG}"   # free text has no id, so the branch is senior/<slug>
WT="$PWD/.claude/worktrees/${SLUG}"
if [[ -d "$WT" ]]; then
  echo "Reusing worktree $WT"
else
  git fetch origin "$BASE" 2>/dev/null || true
  git worktree add -b "$BRANCH" "$WT" "$BASE"
fi
cd "$WT"
# Dependencies only when a lockfile names the package manager.
[[ -f pnpm-lock.yaml ]] && pnpm install --frozen-lockfile
[[ -f yarn.lock ]] && yarn install --frozen-lockfile
[[ -f package-lock.json ]] && npm ci
```

## 3. Scope manifest

Write `$WT/.senior-scope.md`:

```
SCOPE MANIFEST:
  IN SCOPE:
    - <one line per acceptance criterion, or per concrete ask in the text>
  OUT OF SCOPE:
    - anything not listed above
    - refactors of code the ticket does not name
  in_scope_globs:
    - <best guess from the ticket; the user tightens this>
```

Print it and ask the user to confirm or edit it before continuing. This is the one pause in the command.

## 4. Spawn the senior agent

One `Agent` call, `subagent_type: senior`. The prompt carries, in this order:

```
WORKING_DIR=<absolute $WT>
BASE_BRANCH=<BASE>

<contents of .senior-scope.md>

## Ticket <TICKET_ID>: <TITLE>
<BODY>
```

## 5. Quality gates

Detect the runner from the worktree and run what exists:

| Present | Run |
|---|---|
| `package.json` with `build` / `lint` / `typecheck` / `test` scripts | each script that exists, via the package manager from step 2 |
| `Makefile` with a `test` target | `make test` |
| `Cargo.toml` | `cargo build && cargo test` |
| `pyproject.toml` | `pytest` when installed, else report "no test runner" |
| none of the above | report "no gates detected" and continue |

On failure, hand the full output back to the same senior agent with "fix these failures within the scope manifest", max 2 retries, then stop and report.

## 6. Stop and report

Print this block, then end the turn:

```
Branch:   <BRANCH>  (base <BASE>)
Worktree: <WT>
Changes:  <git -C "$WT" diff --stat "$BASE...HEAD">
Gates:    <pass/fail per gate>

Swarm review before pushing (static, haiku finders, verified findings):
  /review-swarm --dir <WT> --base <BASE>
When the diff looks right:
  git -C <WT> push -u origin <BRANCH>
  gh pr create --base <BASE> --fill --repo <OWNER/REPO>
Independent review afterwards:
  /review-pr <pr-url>
```

Pushing and opening the PR are the user's decision, so the command prints those commands rather than running them.

## Related

- `/review-swarm --dir <WT> --base <BASE>` — swarm review of the worktree before it is pushed; verdict in `<WT>/.team-verdicts/review-swarm.md`
- `/review-pr <pr-url>` — review + QA an existing PR, verdicts to files by default
- `/team <issue>` — the full squad pipeline with Dispatcher capacity gating (vig only)
- `decompose-ticket` — plan the cut before running `/senior` on a large ticket
