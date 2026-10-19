# ramble-pm memory

## Project
- Ramble = demo marketplace for bookable experiences; proves Dave's planning method + his agent team. Spec: `docs/plan/BUILD-PLAN.md`.
- Repo started 2026-09-28, fresh (no Cat Pass history). Not on GitHub yet.
- Figma file: https://www.figma.com/design/tGNKJSWGHyx4UVmpnd5LUp (page "Core flow (desktop)", 6 screens + notes + click-through). Screen frame ids: home 2:6, search 2:179, detail 3:2, cart 3:133, checkout 3:253, confirm 3:382.
- Figma account (checked 2026-10-18): Full seat, Professional plan, team "Davd Fleming's team", admin. Code Connect fits: one active library, one active framework. The Ramble file is in a team project, so it can be published. The file auto-subscribes to community kits (Material 3, Simple Design System, Apple OS kits); don't build from them (PRD-77).
- Figma library built 2026-10-18 (direction A, Sunday paper). Node and variable IDs plus build lessons: `docs/design/figma-library.json`. Build flow screens from instances only.
- Vault root: `/Users/davidfleming/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dave's Dev Brain/` (not under git; iCloud only).
- Perf Lab brief (2026-10-08, Ramble also hosts perf examples, planted later in a separate branch): vault `Projects/Personal/Ramble Perf Lab - Kickoff.md`. Its detail-page fixes are build requirements per Dave.
- Market scan output: `docs/product/market/` (`market-scan.md` summary, `teardowns/`). It informs the PRD as context only; client facts come from transcripts.

## How Dave wants work run
- Keep research small; add more later when a question needs it. Check scope with him before launching anything beyond the spec's wording (2026-10-16, he cut a 40-agent scan to 13).
- Research agents read pages only: never pickers, carts, checkouts, forms, sign-ins, or Playwright on live sites.

## Settled (don't re-argue)
- Domain is bookable experiences, not physical goods (2026-09-16).
- Home page does the discovery job; no separate discovery page. Blocks are config-driven modules (2026-09-16).
- Discovery + PRD come before research; Ramble is run as a client engagement for a brand-new site (2026-09-28).
- Discovery skipped 2026-10-18: the PRD is drafted from `docs/product/discovery/sealed/client-brief.md`, which the PM may now read. No reveal or discovery delta. `ramble-client` still exists for follow-up questions.
- Single-page checkout; two-step deferred (2026-09-28).
- Mobile first from the design phase on; desktop v0 is content inventory (2026-09-28).
- Prior client work is evidence, never a template.

## Dave
- One item at a time. Hand him the next action, not a list.
- Runs parallel agent teams; estimate around validation gates, not sequential dev time.
- Dave has other commitments alongside Ramble (tracked by Cleo in the vault, not here). Don't schedule around them; ask.
