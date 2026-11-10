# Preflight: <project>

The setup the build needs before its first unit starts. The agent drafts this runbook and walks it as a dry run; the lead then does each row for real. Closes the `preflight` unit. The GitHub side (public repo, the agents' App, rulesets, workflows, board, hosting link) follows `references/project-setup.md` in the plan-project skill; the merge-desk scripts and rulesets are the `merge-desk` unit, after `scaffold`.

Secrets go from the provider straight into the env store and `.env`. Never paste one into a chat, a ticket, or this file.

## Services

One row per outside service: hosting, database, storage, email, payments, error tracking, analytics, design tool, CI.

| Service | Account (whose) | Plan or tier | Caps that bite on this tier | Workaround when a cap is hit | Secrets it issues | Where each secret lives | Done |
|---|---|---|---|---|---|---|---|
| | | | | | | env store: Production, Preview; `.env` | [ ] |

## Environments

| Environment | URL | Database or branch | Who can see it | Done |
|---|---|---|---|---|
| Local | | | | [ ] |
| Preview | | | | [ ] |
| Production | | | | [ ] |

## Repository rules

| Rule | Setting | Done |
|---|---|---|
| Default branch protected | | [ ] |
| Required checks | build, lint, typecheck, test | [ ] |
| Who can merge, and how | | [ ] |
| Who can deploy to production | | [ ] |

## Agent access

What the agents' sandbox needs so the gates can run: network hosts, local ports, the database and the browser for QA.

| Need | Setting | Tested by | Done |
|---|---|---|---|
| | | | [ ] |

## Dry run

| Date | Walked by | Rows that failed or were unclear | Fixed |
|---|---|---|---|
| | | | |
