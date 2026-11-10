# Project setup: GitHub, CI, agent identity and merge desk

How a new repo is set up so agents can build in it under hard gates. Distilled from Ramble (Oct to Nov 2026): `ramble/docs/plan/merge-desk-runbook.md`, `ramble/docs/adr/0007-hosting-and-ci.md`, `ramble/docs/adr/0010-agent-workflow.md`, `ramble/.github/workflows/`, `ramble/scripts/merge-desk/`, and the `ramble-pm` decisions log. The `preflight` unit walks sections A to C and G to H; the `merge-desk` unit builds D to F.

Every step is **[Lead]** (the person; creates or changes GitHub settings) or **[Agent]** (writes files, opens PRs). An agent never creates the App, edits rulesets, sets secrets, changes visibility, or merges with bypass.

## Values

| Name | Example | Where it goes |
|---|---|---|
| Repo | `owner/name` | scripts, rulesets, workflows |
| App name | `<name>-agents-<owner>` (App names are global) | A |
| Local config folder | `~/.config/<name>-agents/` (outside the repo; not named `.env`, so the secret guard allows the conf file) | B |
| GitHub Actions integration id | `15368` (fixed by GitHub) | E |
| Agent check names | `review-agent`, `qa-agent`, `spec-compliance`, plus the enabled specialists (`a11y-audit`, `architecture-audit`, `perf-check`) | D, E |
| Branch prefixes agents may push | `unit/<id>-*`, `pm/*`, `revert/*` (Ramble also had `sync/*` for its integration branch) | D |

## A. Repository [Lead]

1. Create it public. Public gets free rulesets, CodeQL, secret scanning with push protection, and unlimited Actions minutes; rulesets on a private personal repo need a paid plan (Ramble, DECISIONS 2026-10-18). If it must start private, plan the switch before the first agent unit.
   ```bash
   gh repo create owner/name --public --source . --remote origin && git push -u origin main
   ```
2. Merge methods: squash for units, delete branch on merge, auto-merge on. Merge commits only if there is a promotion branch.
   ```bash
   gh repo edit owner/name --enable-auto-merge --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
   ```
3. Security tab: secret scanning and push protection on; private vulnerability reporting on; Dependabot alerts on. Default-branch deletion protection comes from the ruleset in E.
4. Labels for the board and the tickets if the project uses them; a PR template only if the team has one.

## B. Agent identity: the GitHub App [Lead]

Agents never use the lead's `gh` login. They act as an App, so the lead's approval counts on GitHub (an account cannot approve its own PR) and the App's permissions bound what agents can do.

1. github.com, avatar, Settings, Developer settings, GitHub Apps, New GitHub App. Name `<name>-agents-<owner>`, homepage the repo URL, webhook **inactive**.
2. Repository permissions, exactly these, everything else No access: **Checks** read and write, **Commit statuses** read and write, **Contents** read and write, **Pull requests** read and write, **Metadata** read (automatic). Add **Issues** read and write only if the PM files tickets as the App (Ramble needed it later; without it label writes failed silently and a run double-filed 181 tickets). No Administration, no Workflows, no Secrets, no Actions, no Environments: that is what keeps agents off `.github/workflows`, rulesets and secrets.
3. Only on this account. Create. Note the **App ID** and **Client ID**.
4. Private keys, Generate. Move the `.pem` out of Downloads:
   ```bash
   mkdir -p ~/.config/<name>-agents && chmod 700 ~/.config/<name>-agents && mv ~/Downloads/<name>-agents-*.private-key.pem ~/.config/<name>-agents/app-key.pem && chmod 600 ~/.config/<name>-agents/app-key.pem
   ```
5. Install App, Only select repositories, this repo. The URL ends in the **installation ID**.
6. Record the ids (no secret in this file; the key path is a path):
   ```bash
   printf 'APP_ID=%s\nAPP_CLIENT_ID=%s\nAPP_INSTALLATION_ID=%s\nAPP_KEY=%s\n' "<App ID>" "<Client ID>" "<installation ID>" "$HOME/.config/<name>-agents/app-key.pem" > ~/.config/<name>-agents/app.conf
   ```
   Rotation: generate a new key on the App page, replace the file, confirm a token mints, then delete the old key (`ramble/docs/runbooks/secret-rotation.md`).

## C. Workflows [Agent writes, Lead merges]

Copy from `ramble/.github/workflows/` and adapt. Pin third-party actions to a commit SHA with the version in a comment; `permissions:` at the minimum; `persist-credentials: false` on checkout; `concurrency` per ref with cancel-in-progress.

| File | What it does | Required check? |
|---|---|---|
| `ci.yml` | One job per gate from a matrix: `format:check`, `lint`, `typecheck`, `test`, `build`, `knip`; separate jobs for anything needing a service (`db`) or a browser (`e2e` with Playwright, `--trace off`; axe inside it). Node from `.nvmrc`, pnpm with `--frozen-lockfile` | Yes, every job name |
| `scope-manifest.yml` | `pull_request_target`, runs the base branch's `scripts/merge-desk/scope-check.ts` against PR metadata only; nothing from the PR head executes | Yes |
| `codeql.yml` | JavaScript/TypeScript analysis on PR, push and weekly | Advisory |
| `gitleaks.yml` | Full-history secret scan on PR, push and weekly | Advisory, read its failures |
| `osv-scanner.yml` | Lockfile vulnerabilities: PR fails only on what it adds; weekly reports everything. `osv-scanner.toml` holds dated ignores with reasons | Advisory |
| `nightly-smoke.yml` | Nightly smoke on `main` (and a promotion branch if one exists), posting a commit status | Only with a promotion branch |
| `lighthouse.yml` or a job in `ci.yml` | Lighthouse CI with budgets on two or three pages | Project's call |
| `dependabot.yml` | Weekly, Monday, grouped minor and patch for npm and for Actions, 5 PRs each | n/a |

Ramble's `ci.yml` added a `db` job (Postgres service, migrate, drift check) and a `storybook` job (every story in Chromium with axe). Take only what the stack has.

## D. Merge-desk scripts [Agent writes, Lead reviews] (the `merge-desk` unit)

Port `ramble/scripts/merge-desk/` with its tests. What each does, and what changes per project:

| Script | Does | Change per project |
|---|---|---|
| `app-token.ts` | Reads `app.conf`, signs an RS256 JWT (iat 60 s back, exp 9 min, iss the Client ID), mints a one-hour installation token, prints only the token | conf path and variable names |
| `agent-git.ts` | The agents' only route to GitHub: `push <branch>` (token in an `http.extraheader`, never in the URL), `pr <base> <title> <body-file>`, `automerge <pr>` (`--auto --squash`, never `--admin`), `review <pr>` (requests the lead's review). Refuses `main`, any branch outside the allowed prefixes, a non-HTTPS remote | `REPO`, `REVIEWER`, `BRANCH_PATTERN`, allowed bases (drop `integration` when there is one tier) |
| `post-check.ts` | Posts one completed check run as the App: `--name`, `--sha`, `--conclusion success|failure`, `--summary-file` (cut at 65,000 chars) | `REPO`, `CHECK_NAMES` |
| `scope-check.ts` | The `scope-manifest` check: title starts with a unit id from the plan record (or `PM bookkeeping:`), branch name matches the unit, protected paths untouched (`.github/`, `.claude/`, `CLAUDE.md`, `scripts/merge-desk/`, `docs/adr/`, `docs/plan/`), a bookkeeping PR touches only the plan record files and only allowed fields | the unit record it reads (`plan.json` instead of `units.yaml`), protected paths, bookkeeping files; drop tier and promotion rules when there is one tier |
| `revert.sh` | Opens a revert PR through the same checks and queues auto-merge | nothing |
| `approval-window.sh on|off` | Lead only: sets required approvals to 1 or 0 on the ruleset | ruleset ids |

One tier is enough for a project with no money, auth or data paths: every unit PRs into `main`. Ramble's second tier (`integration`, weekly promotion by the lead) exists for its payments and holds; it also caused the branch-deletion incident below.

## E. Rulesets [Lead]

One ruleset per protected branch. Requires a PR, blocks deletion and force push, requires the checks pinned to their source so nothing else can post a passing one: CI job names and `scope-manifest` to Actions (`15368`), agent checks to the App ID. Bypass list: the repository admin role only (`actor_id` 5), mode `pull_request` rather than `always` (with `always`, a bypass merge under the lead's login deleted Ramble's `integration` branch on 2026-10-24).

```bash
source ~/.config/<name>-agents/app.conf
gh api -X POST repos/owner/name/rulesets --input - <<EOF
{
  "name": "main: agent auto-merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" } ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "format:check", "integration_id": 15368 },
          { "context": "lint", "integration_id": 15368 },
          { "context": "typecheck", "integration_id": 15368 },
          { "context": "test", "integration_id": 15368 },
          { "context": "build", "integration_id": 15368 },
          { "context": "knip", "integration_id": 15368 },
          { "context": "e2e", "integration_id": 15368 },
          { "context": "scope-manifest", "integration_id": 15368 },
          { "context": "review-agent", "integration_id": $APP_ID },
          { "context": "qa-agent", "integration_id": $APP_ID },
          { "context": "spec-compliance", "integration_id": $APP_ID },
          { "context": "a11y-audit", "integration_id": $APP_ID } ] } }
  ]
}
EOF
```

- Start with the **approval window on** (1 approval, dismissed on push): agents request the lead's review and queue auto-merge, so the lead's approval merges. Close it (`approval-window.sh off`) once the first few merges have shown the checks hold. Ramble ran it 2026-10-21 to 10-24.
- A check is required only after the thing that posts it exists, or no PR can pass. Add CI job names after `scaffold` merges; add an agent check after `post-check.ts` accepts its name. Checks are commit-scoped: a green run on a sha satisfies every PR at that sha, so close a superseded PR before queueing auto-merge on its replacement.
- `strict` off keeps rebase churn down; a nightly smoke catches semantic conflicts if several units merge a day.
- Read back: `gh api repos/owner/name/rulesets` and `gh api repos/owner/name -q '{auto_merge: .allow_auto_merge, squash: .allow_squash_merge}'`.

## F. Permissions for the agents [Lead]

User-level `permissions.ask` prompts on `git push`, `gh pr create|merge` and `gh issue create` everywhere; keep that. Allow only the merge desk's own scripts, in the project's gitignored `.claude/settings.local.json`:

```json
{ "permissions": { "allow": [
  "Bash(bun scripts/merge-desk/agent-git.ts *)",
  "Bash(bun scripts/merge-desk/post-check.ts *)",
  "Bash(bun scripts/merge-desk/app-token.ts)",
  "Bash(scripts/merge-desk/revert.sh *)" ] } }
```

Then the dry run [Agent, reported to the Lead]: (1) a `pm/dry-run` PR pushed and opened through `agent-git.ts`, the agent checks posted with `post-check.ts`, `scope-manifest` green, auto-merge lands it after the lead's approval; (2) a PR with one check failing does not merge; (3) `revert.sh` on the dry-run PR auto-merges; (4) `agent-git.ts push main` is refused.

## G. Project board [Lead creates, PM maintains]

```bash
gh project create --owner owner --title "<project>"
```

Fields mirroring the plan record: Status (Todo, In progress, In review, Done), Unit id, Route, Milestone, Complexity, Uncertainty, Estimate o/m/p, Actual days, Owner minutes, Rounds. One issue per ticket; the issue number goes in the status file. A GitHub App cannot edit a user-owned project, so board edits run under the lead's login; issue creation can run as the App if it has Issues permission.

## H. Hosting (Vercel) [Lead]

Link the repo to a Vercel project; production from `main`; previews per PR. `vercel.json` `git.deploymentEnabled` can turn previews off per branch prefix (Ramble turned off `unit/*`, `pm/*`, `revert/*`, `dependabot/**` to save Hobby's 100 deploys a day; a content site that proofreads on previews keeps them on). Env vars in the Vercel store per environment, typed by the lead, never in chat. Hobby is for non-commercial personal use; a portfolio qualifies, a demo that processes payments does not.

## Lessons from Ramble worth keeping

- The App has no `workflows` permission by design, so any `.github/` change is the lead's push and bypass merge. Budget for it.
- Pin agent checks to the App id and Actions checks to 15368, or anything can post a green check.
- A merge rule that depends on a unit's own files (the merge desk) means that unit merges by bypass. Say so in its ticket.
- `scope-manifest` is commit-scoped; duplicate PRs on one sha both merge.
- Record owner minutes with tooling, not by hand: Ramble's rows were blank.
- The breakdown must carry the merge-desk unit from the first draft; Ramble added U-118 after the freeze.
