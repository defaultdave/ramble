# Ramble

Demo marketplace for bookable experiences, built to prove a planning method and an AI agent team workflow.

- **Run the project:** `claude --agent ramble-pm`. The PM reads `docs/plan/BUILD-PLAN.md` (the spec) and `docs/plan/STATUS.md` (where things are).
- **Discovery:** skipped on 2026-10-18; the PRD is drafted from the client brief. `ramble-client` stays available for follow-up questions in character. See `docs/product/discovery/README.md`.
- **Decisions:** `docs/plan/DECISIONS.md`. ADRs in `docs/adr/`.
- **Design:** Figma `Ramble Core Flow Wireframes`, https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp

## Rules for any session in this repo
- Mobile first. Min-width breakpoints.
- Prior client work is evidence, never a template. No names, URLs, copy, or URL shapes from it.
- Plan files are read-only after the `plan-frozen-*` tag. Reality goes in `docs/plan/delta-log.md`.
- The client brief in `docs/product/discovery/sealed/` is the PRD's source since 2026-10-18 (see `docs/plan/DECISIONS.md`). `ramble-pm` may read it.
- No push, PR, issue, repo creation, or deploy without Dave. Print the command.
