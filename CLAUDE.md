# Ramble

Demo marketplace for bookable experiences, built to prove a planning method and an AI agent team workflow.

- **Run the project:** `/ramble-pm` in a desktop chat (project skill in `.claude/skills/ramble-pm/`), or `claude --agent ramble-pm` in a terminal. The PM reads `plan/BUILD-PLAN.md` (the spec) and `STATUS.md` (where things are) in the `ramble-pm` repo.
- **Discovery:** skipped on 2026-10-18; the PRD is drafted from the client brief. `ramble-client` stays available for follow-up questions in character. See `docs/product/discovery/README.md`.
- **Project state:** https://github.com/defaultdave/ramble-pm holds `STATUS.md`, `DECISIONS.md`, `delta-log.md`, and the roadmap page, checked out beside this repo (`bun scripts/pm/site.ts dir`). The PM publishes it straight to `main`; status never needs a PR here. Unit status and actuals live on project board #19. ADRs in `docs/adr/`.
- **Design:** Figma `Ramble Core Flow Wireframes`, https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp

## Rules for any session in this repo
- Mobile first. Min-width breakpoints.
- Comments only when the code cannot say it itself: name things so the code documents itself. A comment states a non-obvious why, never what the next line does.
- Prior client work is evidence, never a template. No names, URLs, copy, or URL shapes from it.
- Plan files are read-only after the `plan-frozen-*` tag. Reality goes in `delta-log.md` in `ramble-pm`.
- The client brief in `docs/product/discovery/sealed/` is the PRD's source since 2026-10-18 (see `DECISIONS.md` in `ramble-pm`). `ramble-pm` may read it.
- No repo creation, issue, or deploy without Dave. Print the command. Tiered auto-merge is on (ADR 0010, switched on 2026-10-21): agents push unit branches, open PRs, post checks, and set auto-merge only through `scripts/merge-desk/`, never with Dave's login. Every unit merges to `main` when every required check passes; a critical-tier unit also waits for `human-read`, which only Dave's approval passes (ADR 0010, amended 2026-11-04). Only Dave approves those reads, merges with bypass, and changes the rulesets, the App, secrets, or these rules.
