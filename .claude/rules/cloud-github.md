# GitHub in cloud sessions

This applies only when `CLAUDE_CODE_REMOTE` is `true`, which means a Claude Code cloud session. In a local session, ignore this file and use `gh` as usual.

In a cloud session, every GitHub request goes through a proxy, and the proxy blocks GitHub's GraphQL API. The `gh pr …`, `gh issue …` and `gh repo view` subcommands use GraphQL, so they fail with a 403 that starts "GitHub GraphQL is not available from Claude Code sessions". Use the REST API through `gh api` instead.

Get the repository from the remote. `gh repo view` is blocked too:

```bash
REPO=$(git remote get-url origin | sed -E 's#.*[/:]([^/]+/[^/]+)$#\1#; s#\.git$##')
```

| Instead of | Use |
|---|---|
| `gh pr view N` | `gh api repos/$REPO/pulls/N --jq '{title, body, state, head: .head.ref, base: .base.ref, author: .user.login}'` |
| `gh pr diff N` | `gh api repos/$REPO/pulls/N -H "Accept: application/vnd.github.diff"` |
| `gh pr diff N --name-only` | `gh api repos/$REPO/pulls/N/files --paginate --jq '.[].filename'` |
| `gh pr list` | `gh api "repos/$REPO/pulls?state=open" --jq '.[] \| "\(.number) \(.head.ref) \(.title)"'` |
| `gh pr comment N --body-file F` | `gh api repos/$REPO/issues/N/comments -F body=@F` |
| `gh pr checks N` | `SHA=$(gh api repos/$REPO/pulls/N --jq .head.sha)`, then `gh api repos/$REPO/commits/$SHA/check-runs --jq '.check_runs[] \| "\(.name) \(.status) \(.conclusion)"'` |
| `gh issue view N` | `gh api repos/$REPO/issues/N --jq '{title, body, state, labels: [.labels[].name]}'` |
| `gh issue view N --comments` | `gh api repos/$REPO/issues/N/comments --paginate` |
| `gh issue edit N --body-file F` | `gh api -X PATCH repos/$REPO/issues/N -F body=@F` |

Rules for cloud sessions:

- Push only the session's own branch. Never push to `main`.
- Don't open the pull request yourself. Leave it to Dave through the session's Create PR button, or print the REST command for him: `gh api repos/$REPO/pulls -f title="…" -f head=<branch> -f base=main -F body=@<file>`.
- Never merge a PR, close or create an issue, create a release, or delete a branch from a cloud session. Print the command and stop.
- `GH_TOKEN` and `GITHUB_TOKEN` read `proxy-injected`. The proxy adds the real credential, so don't print them and don't depend on their value.
