# Ramble

Demo marketplace for bookable experiences, built to prove a planning method and an AI agent team workflow.

- **Run the project:** `/ramble-pm` in a desktop chat (project skill in `.claude/skills/ramble-pm/`), or `claude --agent ramble-pm` in a terminal. The PM reads `docs/plan/BUILD-PLAN.md` (the spec) and `docs/plan/STATUS.md` (where things are).
- **Discovery:** skipped on 2026-10-18; the PRD is drafted from the client brief. `ramble-client` stays available for follow-up questions in character. See `docs/product/discovery/README.md`.
- **Decisions:** `docs/plan/DECISIONS.md`. ADRs in `docs/adr/`.
- **Design:** Figma `Ramble Core Flow Wireframes`, https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp

## Rules for any session in this repo
- Mobile first. Min-width breakpoints.
- Comments only when the code cannot say it itself: name things so the code documents itself. A comment states a non-obvious why, never what the next line does.
- A `TODO` for future work is fine and always names the ticket that will do it (`TODO(U-123): ...`). No other comment mentions a ticket number, above all not its own ticket or one that is closed; that history lives in git and the PR.
- Prior client work is evidence, never a template. No names, URLs, copy, or URL shapes from it.
- Plan files are read-only after the `plan-frozen-*` tag. Reality goes in `docs/plan/delta-log.md`.
- The client brief in `docs/product/discovery/sealed/` is the PRD's source since 2026-10-18 (see `docs/plan/DECISIONS.md`). `ramble-pm` may read it.
- No repo creation, issue, or deploy without Dave. Print the command. Tiered auto-merge is on (ADR 0010, switched on 2026-10-21): agents push unit branches, open PRs, post checks, and set auto-merge only through `scripts/merge-desk/`, never with Dave's login. Standard-tier units merge to `main` and critical-tier units to `integration` when every required check passes. Only Dave promotes `integration` to `main`, merges with bypass, and changes the rulesets, the App, secrets, or these rules.
