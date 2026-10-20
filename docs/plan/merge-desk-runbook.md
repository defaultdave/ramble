---
title: Merge desk runbook (U-118)
date: 2026-10-20
status: draft for Dave; nothing in it has been run
implements: ADR 0010 "Merge rule for the P5 build"; DECISIONS 2026-10-20; design in docs/adr/research/merge-desk-setup.md
unit: U-118 Merge desk and agent identity (units.yaml)
---

# Merge desk runbook

This sets up tiered auto-merge.

- **Standard-tier units** merge to `main` themselves when every required check passes.
- **Critical-tier units** merge to `integration` the same way.
- **Only you** promote `integration` to `main`.

Every step is labelled **[Dave]** or **[PM]**.

**The PM never runs a step that creates or changes GitHub settings.** That covers the App, installs, rulesets, repo settings, secrets, and visibility. The PM also never touches the Claude Code permission settings, `CLAUDE.md`, or `.claude/agents/ramble-pm.md`. The PM writes files on the U-118 branch and opens PRs. Every command marked [Dave] is yours to run.

Values used below:

| Name | Value |
|---|---|
| Repo | `defaultdave/ramble` |
| App name | `ramble-agents-defaultdave` (App names are global; pick another if taken) |
| Local config folder | `~/.config/ramble-agents/` (outside the repo) |
| GitHub Actions' integration ID | `15368` (fixed by GitHub) |

## Order

| Phase | When | Steps |
|---|---|---|
| A. The App | Before the freeze | A1 to A4 [Dave] |
| B. The files | U-118, first unit of P5 | B1 [PM], B2 [Dave] |
| C. Repo settings and rulesets | Right after the repo goes public at the freeze; rulesets on a private personal repo need a paid plan | C1 to C4 [Dave] |
| D. Switch on | After C | D1 [Dave], D2 [PM], D3 [Dave] |
| E. Weekly promotion | Every week in P5 | E1 [Dave], E2 [PM] |
| F. Revert and break-glass | When needed | F1 [PM or Dave], F2 [Dave] |

## A. The App (agent identity)

**A1 [Dave] Create the GitHub App.** Click path:

1. github.com, then your avatar, **Settings**, **Developer settings**, **GitHub Apps**, **New GitHub App**.
2. **GitHub App name:** `ramble-agents-defaultdave`.
3. **Homepage URL:** `https://github.com/defaultdave/ramble`.
4. **Webhook:** untick **Active**. Nothing needs events.
5. **Repository permissions.** Set exactly these and leave every other one at **No access**: no Administration, Workflows, Secrets, Actions, or Environments.
   - **Checks:** Read and write
   - **Commit statuses:** Read and write
   - **Contents:** Read and write
   - **Pull requests:** Read and write
   - **Metadata:** Read-only (set automatically)
6. **Organization and account permissions:** none.
7. **Where can this GitHub App be installed?** **Only on this account.**
8. **Create GitHub App.** Note the **App ID** at the top of the page.

Without the Workflows permission, the agents cannot change `.github/workflows`. Without Administration, they cannot change rulesets or promote `integration`. Leaving the App off the bypass list keeps them inside the required checks.

**A2 [Dave] Make the private key and keep it outside the repo.**

On the App page, under **Private keys**, click **Generate a private key**. A `.pem` file downloads. Then run:

```bash
mkdir -p ~/.config/ramble-agents && chmod 700 ~/.config/ramble-agents
```

```bash
mv ~/Downloads/ramble-agents-defaultdave.*.private-key.pem ~/.config/ramble-agents/app-key.pem && chmod 600 ~/.config/ramble-agents/app-key.pem
```

The PM cannot read `*.pem` files (your deny rules), and it never asks for the key's contents.

**A3 [Dave] Install the App on the repo only.**

1. On the App page, click **Install App**, then **Install** next to `defaultdave`.
2. Choose **Only select repositories**, pick `ramble`, and click **Install**.
3. The browser lands on `github.com/settings/installations/<number>`. That number is the **installation ID**.

**A4 [Dave] Record the two IDs** where the token script reads them. The file is not named `.env`, so the secret guard leaves it alone, and it holds no secret:

```bash
printf 'RAMBLE_APP_ID=%s\nRAMBLE_APP_INSTALLATION_ID=%s\nRAMBLE_APP_KEY=%s\n' "<App ID>" "<installation ID>" "$HOME/.config/ramble-agents/app-key.pem" > ~/.config/ramble-agents/app.conf
```

## B. The files (U-118's PR)

**B1 [PM] Write and test these on branch `unit/U-118`**, then open the PR. These are repo files, not settings.

**`scripts/merge-desk/app-token.ts`** mints a one-hour installation token for the App.

- It reads `~/.config/ramble-agents/app.conf`.
- It signs an RS256 JWT with the key (`iat` 60 s back, `exp` 9 min ahead, `iss` the App ID).
- It calls `POST /app/installations/{id}/access_tokens` and prints only the token.
- It checks `response.ok` and exits 1 with the status on failure.
- It never logs the key or the JWT.

**`scripts/merge-desk/post-check.ts`** posts one check run as the App:

```bash
bun scripts/merge-desk/post-check.ts --name review-agent --sha <head sha> --conclusion success --summary-file <path>
```

- `--name` is one of `review-agent`, `qa-agent`, `spec-compliance`.
- `--conclusion` is `success` or `failure`.
- It calls `POST /repos/defaultdave/ramble/check-runs` with `status: completed`, the conclusion, and `output.title` plus `output.summary` (cut to 65,000 characters).

**`scripts/merge-desk/agent-git.ts`** is the agents' only route to GitHub. It always uses the App token, never your login. Its subcommands:

| Subcommand | What it does | Refuses |
|---|---|---|
| `push <branch>` | Pushes the branch with the App token in an `http.extraheader`, never in the URL | Any branch not named `unit/U-…`, `pm/…`, `revert/…`, or `sync/…`; `main`; `integration` |
| `pr <base> <title> <body-file>` | `gh pr create` as the App | A base other than `main` or `integration`; a head of `integration` |
| `automerge <pr or branch>` | `gh pr merge <pr> --auto --squash` as the App | `--admin`; any PR whose head is `integration` |

**`scripts/merge-desk/scope-check.ts`** is the `scope-manifest` check. It reads git metadata only and never runs code from the PR. Its rules:

1. **Promotion PRs:** head `integration`, base `main`. Always fails, with the message "Promotion: Dave merges with bypass after the nightly smoke (runbook E1)."
2. **Sync PRs:** head `main` or `sync/…`, base `integration`. They pass.
3. **The title** must start with a unit ID in `units.yaml`, or with `PM bookkeeping:`. A leading `Revert: ` is stripped first.
4. **Protected paths.** Changed files (`git diff --name-only base...PR head`) must not touch `.github/`, `.claude/`, `CLAUDE.md`, `scripts/merge-desk/`, `docs/adr/`, or `docs/plan/`. A bookkeeping PR may touch only `docs/plan/units.yaml`, `docs/plan/STATUS.md`, and `docs/plan/delta-log.md`, and only into `main`.
5. **Tier.** A `review: critical` unit must target `integration`. A standard unit targets `main`, unless its branch carries commits that are on `integration` and not on `main`. Then it must target `integration` too, so nothing reaches `main` around the promotion.

**`scripts/merge-desk/revert.sh`** opens a revert PR that goes through the same checks and auto-merges:

```bash
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
```

**`.github/workflows/scope-manifest.yml`.** It uses `pull_request_target`, so the check runs from the base branch's copy of the script, and it fetches the PR head only to read metadata:

```yaml
name: scope-manifest
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened]
    branches: [main, integration]
permissions:
  contents: read
jobs:
  scope-manifest:
    name: scope-manifest
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Fetch the PR head (metadata only; nothing from it runs)
        run: git fetch origin "pull/${{ github.event.pull_request.number }}/head:pr-head"
      - uses: oven-sh/setup-bun@v2
      - name: Check the PR against the merge rule
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
          BASE_REF: ${{ github.base_ref }}
          HEAD_REF: ${{ github.head_ref }}
          PR_HEAD: pr-head
        run: bun scripts/merge-desk/scope-check.ts
```

**`.github/workflows/nightly-smoke.yml`** smokes `main` and `integration` every night and posts a `nightly-smoke` status on each branch head. The steps skip themselves until U-001 adds `package.json`. The race and access tests run on `integration` once U-014a adds `test:race`; that needs the `NIGHTLY_DATABASE_URL` secret (C4).

```yaml
name: nightly-smoke
on:
  schedule:
    - cron: "0 7 * * *" # 03:00 New York in summer time, 02:00 in winter
  workflow_dispatch:
permissions:
  contents: read
  statuses: write
jobs:
  smoke:
    name: nightly-smoke (${{ matrix.branch }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        branch: [main, integration]
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ matrix.branch }}
      - uses: actions/setup-node@v4
        if: hashFiles('package.json') != ''
        with:
          node-version: 24
      - name: Install
        if: hashFiles('package-lock.json') != ''
        run: npm ci
      - name: Smoke
        if: hashFiles('package.json') != ''
        run: npm run smoke --if-present
      - name: Race and access tests
        if: matrix.branch == 'integration' && hashFiles('package.json') != ''
        env:
          DATABASE_URL: ${{ secrets.NIGHTLY_DATABASE_URL }}
        run: npm run test:race --if-present
      - name: Post the nightly-smoke status
        if: always()
        env:
          GH_TOKEN: ${{ github.token }}
          STATE: ${{ job.status == 'success' && 'success' || 'failure' }}
        run: >
          gh api "repos/${{ github.repository }}/statuses/$(git rev-parse HEAD)"
          -f state="$STATE" -f context=nightly-smoke
          -f description="Nightly smoke on ${{ matrix.branch }}"
          -f target_url="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

The PM tests the three TypeScript scripts with unit tests: token minting against a mocked endpoint, every scope-check rule, and every refusal in `agent-git.ts`. It runs `actionlint` on both workflows if it is installed, and opens the PR with your login, as today.

**B2 [Dave] Review and merge U-118's PR yourself.** The rulesets do not exist yet, so this is an ordinary merge:

```bash
gh pr merge <U-118 PR number> --squash --delete-branch
```

## C. Repo settings and rulesets (after the repo goes public at the freeze)

**C1 [Dave] Merge methods and auto-merge.** Squash is for units. Merge commits are for the weekly promotion, so `main` keeps each unit's commit.

```bash
gh repo edit defaultdave/ramble --enable-auto-merge --enable-squash-merge --enable-merge-commit --enable-rebase-merge=false --delete-branch-on-merge
```

**C2 [Dave] Create the `integration` branch from `main`.**

```bash
gh api repos/defaultdave/ramble/git/refs -f ref=refs/heads/integration -f sha="$(gh api repos/defaultdave/ramble/git/ref/heads/main -q .object.sha)"
```

**C3 [Dave] Create the two rulesets.** Each requires a PR, the four checks, and no force pushes or deletion, with 0 approvals. The bypass list holds only the repository admin role (`actor_id` 5). On a personal repo, that role is you alone. Bypass mode `always` is your break-glass (F2). The checks are pinned to their source: `scope-manifest` to GitHub Actions, the three agent checks to the App, so nothing else can post a passing one.

```bash
source ~/.config/ramble-agents/app.conf
```

```bash
for branch in main integration; do
gh api -X POST repos/defaultdave/ramble/rulesets --input - <<EOF
{
  "name": "$branch: tiered auto-merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/$branch"], "exclude": [] } },
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "scope-manifest", "integration_id": 15368 },
          { "context": "review-agent", "integration_id": $RAMBLE_APP_ID },
          { "context": "qa-agent", "integration_id": $RAMBLE_APP_ID },
          { "context": "spec-compliance", "integration_id": $RAMBLE_APP_ID } ] } }
  ]
}
EOF
done
```

- **Up-to-date branches are not required** (`strict` off), to keep rebase churn down. The nightly smoke catches semantic conflicts between units that merged the same day.
- **Once U-001 merges,** add its CI job names to both rulesets with `integration_id` 15368. This was already your U-001 task in artifact 5. To find the IDs, run `gh api repos/defaultdave/ramble/rulesets`. Then run `gh api -X PUT repos/defaultdave/ramble/rulesets/<id> --input -` with the same JSON plus the new checks.

**C4 [Dave] The nightly smoke secret,** when U-014a lands (a Neon branch kept for the overnight race tests). Paste the URL at the prompt; it never goes on the command line:

```bash
gh secret set NIGHTLY_DATABASE_URL --repo defaultdave/ramble
```

Check C1 to C3 by reading them back (the PM may run these, since they only read):

```bash
gh api repos/defaultdave/ramble/rulesets
```

```bash
gh api repos/defaultdave/ramble -q '{auto_merge: .allow_auto_merge, squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge}'
```

## D. Switch on

**D1 [Dave] Let the agents push, open PRs, and set auto-merge in this project.** Your user settings ask before every `git push`, `gh pr create`, and `gh pr merge`. Claude Code checks deny rules, then ask, then allow, so a project allow rule does not lift a user-level ask. Two ways to do it.

- **Option 1 (recommended): allow only the merge desk's own scripts in this project.** Your raw `git push` and `gh pr` prompts stay as they are everywhere, Ramble included. The agents can push only `unit/`, `pm/`, `revert/`, and `sync/` branches as the App, and they can never use `--admin` or merge a promotion (B1). Add this to `/Users/davidfleming/Workspace/ramble/.claude/settings.local.json`, which is gitignored and currently `{}`:

  ```json
  {
    "permissions": {
      "allow": [
        "Bash(bun scripts/merge-desk/agent-git.ts *)",
        "Bash(bun scripts/merge-desk/post-check.ts *)",
        "Bash(bun scripts/merge-desk/app-token.ts)",
        "Bash(scripts/merge-desk/revert.sh *)"
      ]
    }
  }
  ```

- **Option 2: lift the raw prompts.** Remove `Bash(git push *)`, `Bash(gh pr create *)`, and `Bash(gh pr merge *)` from `ask` in `~/.claude/settings.json`. That lifts them for every project, so Option 1 is safer. Your global `CLAUDE.md` also documents those prompts, so it would need the same edit.

To check either option, open a terminal `claude` session in the Ramble folder and run `/permissions`.

**D2 [PM] Dry run.** The PM checks four things:

1. It opens `U-118: dry run` (adds `docs/merge-desk-dry-run.md`) into `integration` through `agent-git.ts`. It posts the three agent checks with `post-check.ts` and confirms that `scope-manifest` passes and the PR auto-merges.
2. It opens a PR with one check left failing and confirms that it does not merge.
3. It runs `scripts/merge-desk/revert.sh` on the dry-run PR and confirms that the revert PR auto-merges.
4. It confirms that `agent-git.ts automerge` refuses a promotion PR.

It reports each result to you. The first real standard-tier merge is U-001, and you watch it.

**D3 [Dave] Change the two hard lines.** The PM does not edit these files. The exact edits are below; make them yourself, or tell the PM in chat to make them on the day you switch auto-merge on.

- **`CLAUDE.md`, the "Rules for any session in this repo" list.**

  Replace:

  > - No repo creation, issue, merge to `main`, or deploy without Dave. Print the command. Pushes to unit branches, PRs, and PR reviews need Dave's approval each time until he opts in to auto mode (ADR 0010).

  with:

  > - No repo creation, issue, or deploy without Dave. Print the command. Tiered auto-merge is on (ADR 0010, switched on YYYY-MM-DD): agents push unit branches, open PRs, post checks, and set auto-merge only through `scripts/merge-desk/`, never with Dave's login. Standard-tier units merge to `main` and critical-tier units to `integration` when every required check passes. Only Dave promotes `integration` to `main`, merges with bypass, and changes the rulesets, the App, secrets, or these rules.

- **`.claude/agents/ramble-pm.md`, Hard lines, first bullet.**

  Replace:

  > - **Never** merge PRs, create or close issues, create repos, or deploy. Print the exact command and let Dave run it. Pushing unit branches, opening PRs, and starting PR reviews need Dave's approval each time until he switches on auto mode (ADR 0010); after that the pipeline does them itself.

  with:

  > - **Never** create or close issues, create repos, deploy, promote `integration` to `main`, merge with `--admin`, or change GitHub settings (App, rulesets, secrets, repo settings). Print the exact command and let Dave run it. Since auto-merge was switched on (ADR 0010, YYYY-MM-DD), unit branches, PRs, check posts, and auto-merge go through `scripts/merge-desk/agent-git.ts` and `post-check.ts` only, as the App; never with Dave's `gh` login.

- **The same file, "Talking to Dave", the "Keep his time small" bullet.**

  Replace:

  > Ask him only for accounts, deploys, merges, and decisions

  with:

  > Ask him only for accounts, deploys, the weekly promotion, and decisions

- **The same file, the Delegation table, the "Review and QA" row.** Add after the agents listed:

  > each verdict posted as a check run with `scripts/merge-desk/post-check.ts`

## E. Weekly promotion

**E1 [Dave] Promote `integration` to `main`,** weekly by default.

Check that last night's smoke on `integration` passed. The answer must be `success`:

```bash
gh api repos/defaultdave/ramble/commits/integration/status -q '.statuses[] | select(.context=="nightly-smoke") | .state'
```

Open the promotion PR. The PM drafts the body (E2):

```bash
gh pr create --repo defaultdave/ramble --base main --head integration --title "Promote integration $(date +%F)" --body-file <path the PM gives you>
```

Read the critical-tier diffs:

```bash
gh pr diff <promotion PR number>
```

Merge with your bypass. `scope-manifest` fails on purpose for promotions:

```bash
gh pr merge <promotion PR number> --admin --merge
```

Promotion is a production change only when you also promote a deploy. Deploys stay yours (ADR 0010).

**E2 [PM] Prepare the promotion and keep `integration` current.**

- **The promotion body** lists the critical units in the batch with their review verdicts and the overnight race and access results. The PM writes it to a local file, not committed, and gives you its path.
- **The sync.** After each promotion, and whenever standard units land that critical work needs, the PM brings `main` into `integration`. It pushes a `sync/YYYY-MM-DD` branch from `main` with `agent-git.ts`, opens it into `integration`, and sets auto-merge.

## F. Revert and break-glass

**F1 [PM or Dave] Revert a merge.** This opens a revert PR that runs the same checks and auto-merges:

```bash
scripts/merge-desk/revert.sh <merged PR number>
```

**F2 [Dave] Break-glass.** When `main` is broken and the checks cannot pass, merge the revert PR past them:

```bash
gh pr merge <revert PR number> --admin --squash
```

## Where the agent checks run (model-call cost)

GitHub supplies the orchestration and the compute for free. The review and QA agents are still model calls, from the setup notes:

| Option | Cost | Notes |
|---|---|---|
| Local Claude Code sessions on your subscription post verdicts as check runs through the App (`post-check.ts`) | No API bill | Your machine must be awake overnight. **Start here.** |
| GitHub Actions with the Claude Code Action on a subscription token | No API bill | Check Anthropic's terms for subscription tokens in CI before relying on it |
| Actions with an API key | Metered | Cleanest unattended; keep it small with Haiku-tier narrow checks |

The setup notes say to start with local sessions and move the cheap narrow checks to Actions later. Moving a check changes who posts it. If Actions posts a check under its own identity, update that check's `integration_id` in both rulesets to 15368. Otherwise, have the Actions job post through the App with `post-check.ts`, which keeps the rulesets as they are.

## What this does not cover

- **Deploys and production promotion.** Still yours, unchanged.
- **The board and issue mirroring** (ADR 0010).
- **Which overnight runner hosts the local sessions.** ADR 0010 leaves this to decide at the walking skeleton.
