# Vercel deploys and the Hobby limit

Which branches create a Vercel deployment, why most do not, and how Dave refreshes production. Written for Dave.

This page records the owner's 2026-10-29 change and supersedes the wording in `docs/adr/0007-hosting-and-ci.md` ("Preview deploy per pull request, production on merge to `main`"). The ADR is protected and unchanged.

Statements marked (unverified) go beyond what the cited Vercel pages say. Each one is to be checked as noted.

## Why most branches no longer deploy

Vercel Hobby allows 100 deployments per rolling 24 hours ([Limits](https://vercel.com/docs/limits#deployments-per-day-hobby)). The error identifier `api-deployments-free-per-day` and the HTTP 402 come from the Vercel CLI error the owner saw on 2026-10-29. The Limits page also lists the identifier, in its rate-limit table row "Deployments per day (Free)" with a limit of 100 per 86400 seconds; I read that row on the page, but not the 402.

The PM measured the previous 24 hours on 2026-10-29 with `vercel ls --json`:

| Source | Deployments |
|---|---|
| Production builds (every merge to `main`) | 45 |
| Previews on `unit/*` | 95 |
| Previews on `pm/*` | 15 |
| Previews on `integration` | 10 |
| Previews on `sync/*` | 7 |
| Previews on `promote/*` | 2 |
| Previews, total | 129 |

That is 45 + 129 = 174 against a cap of 100. The cap blocked a needed production redeploy.

An Ignored Build Step does not help: Vercel's [Project settings](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step) page says canceled builds are counted as full deployments toward the deployment quota. So the route is to not create the deployment, using `git.deploymentEnabled` ([Git Configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)). That page says the setting stops listed branches from triggering a deployment on commits. It does not state the effect on the quota, so "disabled branches no longer count" is (unverified). Measure it after merge: push a `unit/*` branch, confirm no deployment row appears in Vercel, and watch the day's count.

`vercel.json` turns automatic deployments off for `main`, `unit/*`, `pm/*`, `sync/*`, and `promote/*`. Other branches keep Vercel's default of deploying. Two stay on, and `tests/vercel-config.test.ts` fails if a later edit turns them off or covers them with a wildcard:

- `integration`: kept on so its build can still be opened on demand, and because the Vercel and Neon integration wires its Preview environment variables to the `staging` Neon branch (see `docs/runbooks/secret-rotation.md`, Neon database URLs). The nightly smoke does not use it: `.github/workflows/nightly-smoke.yml` checks out the sha and runs `pnpm run smoke` against a local `next start` (`playwright.config.ts`, port 3100).
- `production`: the Production Branch, below.

The Git Configuration page documents the combining rule: patterns are minimatch globs, and a branch that matches several rules deploys if at least one is `true`. That `unit/*` matches `unit/U-001-x` but not a name with a second slash follows from minimatch semantics (unverified against Vercel). The matcher in the test approximates this and supports only `*`. The reasoning lives here because JSON has no comments.

## Neon preview branches for disabled branches

A disabled branch has no preview deployment, so the integration creates no Neon preview branch for it (unverified). The `expire preview branch` job in `.github/workflows/neon-preview-branch.yml` waits 5 minutes for that Neon branch and then fails, so on PRs from `unit/*`, `pm/*`, `sync/*`, and `promote/*` it would fail. A companion change (branch `unit/U-001-neon-skip`, file `.github/workflows/neon-preview-branch.yml`) skips the job for those branches. It lands separately under the owner's login because `.github/` is protected, and it must merge before this change; otherwise the `expire preview branch` job fails on unit, pm, sync, and promote PRs until it lands. Until this change and that one both merge, those PRs still get previews and Neon branches, and the `delete` job removes the branch on close; only the 7-day expiry is skipped for them.

## Seeing a unit's change on demand

Storybook and the PR evidence images are the default way to review a change. When a real deployment is needed, run `vercel deploy` from the unit's branch (not `--prod`). That creates a preview, and each one is expected to use one of the day's 100 (unverified). A push to a disabled branch is expected to create none (unverified, see above).

## Production flow

Production deploys when `production` is pushed. Dave refreshes it under his own login:

```
git fetch origin && git push origin origin/main:refs/heads/production
```

This pushes `origin/main` rather than the local `main`, which can be behind and would create or move `production` at an old commit.

Agents cannot push `production` in practice: `scripts/merge-desk/agent-git.ts` only pushes `unit/`, `pm/`, `revert/`, and `sync/` branches. On 2026-10-29 the PM ran `gh api repos/defaultdave/ramble/rulesets` and found two active rulesets, "main: tiered auto-merge" (`refs/heads/main`) and "integration: tiered auto-merge" (`refs/heads/integration`), neither matching `production`; step 1 below re-checks it. So the restriction is a convention in the script, not a GitHub rule. The commit you push is the one you chose: check CI on `main` first.

## One-time setup (Dave, in Vercel)

Do these in order.

1. Check which rules apply to the `production` branch: run `gh api repos/defaultdave/ramble/rules/branches/production`. Look for any rule of type `creation`, `update`, `deletion`, `non_fast_forward`, or `required_status_checks`; an empty list `[]` means no rule applies. If one applies, your login must be able to bypass it, or the push in step 2 fails. To list the rulesets themselves (id, name, target, enforcement only), run `gh api repos/defaultdave/ramble/rulesets`. Adding a rule that limits who may push `production` is Dave's decision.
2. Create the branch first: `git fetch origin && git push origin origin/main:refs/heads/production`. While the Production Branch setting is still `main`, Vercel builds this push as a preview (unverified). Expect one preview deployment; the integration will probably create a `preview/production` Neon branch with no expiry (unverified), and `scripts/vercel-build.sh` runs `db:migrate` on it. Delete that Neon preview branch afterwards in the Neon console.
3. Set the Production Branch to `production`. Vercel's Git docs ([Production branch](https://vercel.com/docs/git#production-branch)) say: Project Settings, Environments, click Production, Branch Tracking, change the branch name, Save. Verify in the current Vercel UI, since the dashboard layout changes.
4. Trigger the first production deployment. Switching the setting builds nothing by itself, so until this step the live site stays stale. Which command applies depends on `main`:
   - `main` has moved since step 2: run `git fetch origin && git push origin origin/main:refs/heads/production` again. Once the setting is switched, that push is expected to create a Production deployment (unverified). If Vercel instead builds it as a preview, `scripts/vercel-build.sh` runs `db:migrate` when `VERCEL_ENV` is `preview`, so watch this first push and check which environment it used.
   - Nothing new to push (git prints "Everything up-to-date" and no event fires): in the Vercel dashboard use Deployments, Create Deployment, with the branch `production` ([Git docs](https://vercel.com/docs/git#creating-a-deployment-from-a-git-reference)), or run `vercel deploy --prod` from a checkout of `production` ([Environments](https://vercel.com/docs/deployments/environments#production-environment)). Whether either one targets Production for a branch just made the Production Branch is (unverified).
   - `vercel redeploy <latest production deployment URL> --environment production` is a last resort: the latest production deployment predates the switch, so a redeploy rebuilds that old commit and does not pick up code merged since. The flags are not confirmed in the docs I read (unverified); check `vercel redeploy --help`.

Check that Production-scoped environment variables (database, Blob) are present: builds of `production` read Production-scoped variables.

## Warning: until step 4, production goes stale

Merges to `main` are expected to create no deployment at all, since `main` is disabled (unverified, derived from the setting). Until Dave switches the Production Branch and triggers the first production deployment, the live demo does not update after a merge. After the switch it updates only when `git fetch origin && git push origin origin/main:refs/heads/production` runs.

## Still to be confirmed

- Whether disabled branches stay out of the daily deployment count (to be measured after merge).
- What the Vercel dashboard and the GitHub commit status show for a disabled branch. The GitHub page lists deployed, failed, and skipped statuses and says nothing about disabled branches.
- Whether `vercel.json` is read from the pushed commit's own tree. The setting is keyed by branch name, so `production` is unaffected either way.
