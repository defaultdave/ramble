# Vercel deploys and the Hobby limit

Which branches create a Vercel deployment, why most do not, and how Dave refreshes production. Written for Dave.

## Why most branches no longer deploy

Vercel Hobby allows 100 deployments per rolling 24 hours (`api-deployments-free-per-day`, HTTP 402 when hit). Measured over one 24 hour window before this change:

| Source | Deployments |
|---|---|
| Production builds (every merge to `main`) | 45 |
| Previews on `unit/*` | 95 |
| Previews on `pm/*` | 15 |
| Previews on `integration` | 10 |
| Previews on `sync/*` | 7 |
| Previews on `promote/*` | 2 |

That is 174 against a cap of 100, and the cap blocked a needed production redeploy. An earlier attempt skipped builds with an Ignored Build Step, but a build canceled that way still counts toward the quota. The only documented way to stay out of the count is to not create the deployment, which `git.deploymentEnabled` in `vercel.json` does.

`vercel.json` turns automatic deployments off for `main`, `unit/*`, `pm/*`, `sync/*`, and `promote/*`. Every other branch keeps Vercel's default of deploying. Two branches must stay on, and `tests/vercel-config.test.ts` fails if a later edit turns them off or covers them with a wildcard:

- `integration`: the nightly smoke runs against its preview.
- `production`: the Production Branch (below).

Rules combine as Vercel documents: a branch deploys if no rule names it or if any matching rule is `true`. Patterns are minimatch globs, so `unit/*` matches `unit/U-001-x` but not a branch with a second slash. The reasoning lives here because JSON has no comments.

## Seeing a unit's change on demand

Storybook and the PR evidence images are the default way to review a change. When a real deployment is needed, run `vercel deploy` from the unit's branch (not `--prod`). It creates a preview and costs one deployment of the day's 100. Pushing the branch does not.

## Production flow

Production deploys when `production` is pushed. Dave refreshes it under his own login:

```
git push origin main:production
```

Agents cannot push `production`. The push is a fast-forward of `main`, so `production` always points at a commit that passed CI on `main`.

## One-time setup (Dave, in Vercel)

Do these in order.

1. Create the branch first: `git push origin main:production`. This push creates a preview deployment, because the Production Branch setting is still `main`.
2. Set the Production Branch to `production`. Vercel's Git docs (https://vercel.com/docs/git#production-branch) describe it as: project Settings, Environments, click Production, Branch Tracking, change the branch name, Save. Verify in the current Vercel UI, since the dashboard layout changes.
3. If the repository rules require it, allow the `production` branch. That is a ruleset decision and Dave's.

Check that Production-scoped environment variables (database, Blob) are present: builds of `production` read Production-scoped variables, and `main` no longer builds at all.

## Warning: until step 2, production goes stale

Merges to `main` no longer create any deployment. Until Dave switches the Production Branch and pushes `production`, the live demo does not update after a merge. After the switch it updates only when `git push origin main:production` runs.

## What the docs did not confirm

The Vercel docs do not state, in words, that a branch disabled by `git.deploymentEnabled` is excluded from the daily deployment count, nor what the dashboard or GitHub status shows for it, nor that `vercel.json` is read from the pushed commit's own tree. After the first merge, confirm in Vercel's Deployments list that a `unit/*` push creates no row, and watch the usage count over a day.
