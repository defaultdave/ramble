# Decisions

| Date | Decision | By | Why |
|---|---|---|---|
| 2026-09-16 | Domain is bookable experiences | Dave | Reuses what exists; it's a product demo |
| 2026-09-16 | Home page does the discovery job | Dave | In generic commerce, home is the discovery surface; the reusable part is the module system |
| 2026-09-20 | Name is Ramble; the cat theme is dropped | Dave | Generic marketplace, no prior-client framing |
| 2026-09-28 | Fresh repo, no Cat Pass history | Dave (via this setup) | Cat Pass is public and carries prior-client framing; salvage is ADR R9 |
| 2026-09-28 | Mobile first from the design phase on | Dave | Commerce traffic is mostly phones; retrofitting mobile costs more than expanding to desktop |
| 2026-09-28 | Discovery + PRD before any research or technical decision | Dave | Research answers how; it needs the business needs first. Treat Ramble as a client engagement for a brand-new site |
| 2026-09-28 | Single-page checkout; two-step deferred to later, if ever | Dave | Not needed for launch |
| 2026-09-28 | Client played by `ramble-client` agent with a sealed brief Dave doesn't read; reveal and discovery delta after PRD sign-off | Dave | Rehearses real discovery; the delta becomes part of the package |
| 2026-09-28 | Project run by `ramble-pm` agent with project memory | Dave | Worked on the prior checkout project |
| 2026-10-08 | Ramble carries the performance examples as well as the planning demo. Best-case build first, on this plan. The planted performance problems come later in a separate branch, deployable on its own | Dave | One site for both jobs; a branch is easy to point to and to update; the plan and frozen estimate stay intact |
| 2026-10-16 | Market scan kept small: 6 competitors on the plan's three topics (booking flow, fees, cancellation), fee and cancellation claims fact-checked. Supply side, market size, SEO, other competitors, and legal floors deferred to later research | Dave | Enough context for discovery and the PRD; more research can follow when a question needs it |
| 2026-10-16 | Research agents read pages only: no pickers, carts, checkouts, forms, sign-ins, or Playwright | Dave | An agent clicked into a live Eventbrite checkout during the first run |
| 2026-10-18 | Discovery role play skipped. The sealed-brief rule is lifted: ramble-pm drafts the PRD straight from `docs/product/discovery/sealed/client-brief.md`. Session 1 closed after the opening greeting. No reveal or discovery delta, so the package drops the "what discovery missed" piece | Dave | Get to the spec and the build sooner; the brief already holds the business facts |
