---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/package.json"
---
# Quality Gates

## Commands

Run in order from the working directory (`WORKING_DIR` when the prompt provides one, otherwise the repo root). All must pass.

```bash
cd "${WORKING_DIR:-.}"
npm run build && npx eslint . && npx tsc --noEmit && npm test
```

A project with a different toolchain substitutes its own build, lint, typecheck, and test scripts. The rule is the sequence and the all-must-pass bar, not the exact commands.

## Who runs them

- **the implementer** (senior) runs the gates after implementing and fixes failures before handing off, max 3 attempts
- **the caller** re-runs them independently before review (trust but verify)
- **qa** runs them again as part of its independent verification

## Runtime smoke test

Gates verify build-time correctness only. After they pass, start the app and hit the key routes; read the response body, because a 200 that renders an error page is still a failure. The squad pipeline's port-allocation recipe lives in the `office-discipline` rule.

## On failure

- During implementation: senior fixes, max 3 attempts
- During QA: report FAIL with the output and route back to senior
- A failing gate blocks the hand-off; a PR passes only when every gate passes
- Runtime failures count the same as build failures

> See [docs/rules/quality-gates.md](../../docs/rules/quality-gates.md) for rationale and history.
