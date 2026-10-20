---
title: U-028, Code Connect spike
date: 2026-10-19
status: done; one blocker for Dave (plan)
units: U-028, sizes U-029
code: docs/adr/research/spikes/u-028-code-connect/
---

# Code Connect spike (U-028)

## Question

Can Ramble map one primitive to its Figma component with Code Connect, and what does that say about the size of U-029 (map every library component)?

## Result

**The authoring half works. The publishing half is refused on Dave's Figma plan.**

| Step | Result |
|---|---|
| Library published | Yes. 52 components are visible to the Code Connect tools (26 icons, Logo, Illustration, 17 library components, 3 internal `_Flow` parts, `_DatePicker/Day`, Skeleton, BookingPanel) |
| Read the Button's properties | `get_context_for_code_connect` returns `label` (text), `showIcon` (boolean), `iconStart` (instance swap), `variant`, `size`, `state` (variants). Property names are exactly the contract in ADR 0005, so the template needs no renaming |
| Write a React `Button` and a parserless template (`Button.figma.ts`, `figma.code`) | Done; about 20 lines. `figma connect publish --dry-run` (CLI 2.0.2, `@figma/code-connect`) parses it and lists "Button" for the right node |
| Publish the mapping | **Refused by Figma, from both write paths I tried (`add_code_connect_map` with a template, and `send_code_connect_mappings`): "Code connections can only be made in libraries that are in Organization or Enterprise plans."** |
| Publish with the CLI | Not run: it needs a personal access token, and it calls the same Figma service. Expect the same refusal |

## Correction to the record

`STATUS.md` (P3 step 2) recorded that Code Connect works on Professional with a Full seat, from Figma's help pages. The service says otherwise. The plan check was wrong, or the page was out of date. Dave's plan is "Davd Fleming's team", Professional, Full seat, admin (checked with `whoami` today).

## Sizing U-029 if publishing is allowed

- 17 library components plus Skeleton, BookingPanel, and the internal parts: about 21 templates. Icons: one shared template pattern for 26 icons (each needs its own mapping to a Lucide component; script it).
- Component properties total 70 across the 21 published components with properties, a mean of 3.5. Three components have instance-swap props that need nested templates (Button, Chip, Badge); `Header`, `BookingPanel`, `FilterDrawer`, `Card`, and `Alert` nest 3 to 6 other components.
- Button took one short template and no iteration, so the work is mostly mechanical. A unit of about 1 to 1.5 days of agent time plus Dave's review fits. Complexity moves from 1 to 2 for the count and the nesting.

## Decision for Dave (blocks U-029 only, nothing else)

Code Connect would show React snippets in Figma Dev Mode. It does not change what ships. Options:

1. **Keep templates in the repo, unpublished.** They parse and carry the mapping; nothing shows in Figma. Cost: nothing. Loses the demo of the full loop.
2. **Upgrade the team that owns the library to Organization.** Needed for Dev Mode snippets. Cost: the plan price (check Figma's pricing page before deciding), monthly.
3. **Drop U-029.** The naming contract in ADR 0005 already keeps Figma and code aligned.

PM recommendation: option 1 for the demo, and say so in the write-up. The method point ("learn Code Connect on a real project") is met by the spike. Choose 2 only if showing the published loop matters.

## Re-score

| Unit | Before | After |
|---|---|---|
| U-028 | spike, todo | done |
| U-029 | C1 U2 | C2 U2, with a plan blocker in its note |
