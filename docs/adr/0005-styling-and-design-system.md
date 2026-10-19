# ADR 0005: Styling and design system

- **Status:** Accepted 2026-10-18 (Dave), as recommended (CSS Modules).
- **Date:** 2026-10-18
- **Question:** R5 in `docs/plan/BUILD-PLAN.md`
- **Settles stack decisions:** UI-2 (styling system); the "design system or component library" row

## Context

Ramble has a logo and illustrations from a freelance designer and no design system (C-07). The brand is the one thing the founder won't trade (PRD-77). P3 builds tokens and primitives in Figma (variables, then Header, Card, Chip, Button, Input, Order summary), and code should use the same tokens. The house standards default to CSS Modules (UI-2) and require a configured tool to run in CI (SET-12). Two widgets are hard to make accessible from scratch: the date picker and the filter drawer or dialog.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-77 | Bespoke editorial brand, existing assets, a tone checklist at design sign-off |
| PRD-67 | Designed at 390 px first, min-width breakpoints (UI-3) |
| PRD-69 | WCAG 2.2 AA: contrast in both color schemes, visible focus, 24 px targets, accessible date picker and dialog |
| PRD-68 | Small CSS and client JavaScript on phones |
| PRD-02, PRD-11, PRD-14 | Date selection, the filter drawer, and the booking bar are the interactive pieces |

## Options

**A. CSS Modules plus tokens as CSS custom properties.** Figma variables export to a tokens file; a build step (for example Style Dictionary) turns it into CSS custom properties in one global stylesheet. Components use CSS Modules beside the file and reference only tokens. Primitives are written in house on native elements.
- Fit: the house default, so no departure to record; zero runtime; full control of an editorial look; works with Server Components.
- Cost: more naming and more files than utility classes.

**B. Tailwind CSS v4 with tokens in `@theme`.** The same token export feeds Tailwind's CSS-first theme, so utilities can only use brand values.
- Fit: fast for agents to write; tokens enforced through the theme.
- Cost: a departure from the UI-2 default to record; long class strings in markup; the brand lives in class lists rather than stylesheets.

**C. A component library** (shadcn/ui on Radix with Tailwind, or a full kit such as Mantine or Chakra).
- Fit: fastest start.
- Cost and risk: a generic look that fights PRD-77, theming work to undo defaults, and more client JavaScript with some kits.

**For the hard widgets, under A or B:** a headless library behind a wrapper. React Aria Components has a [date picker](https://react-aria.adobe.com/DatePicker) and calendar built for accessibility (labelling, validation states, locale-aware formats), plus a dialog; Radix covers the dialog, and no Radix date picker was found (checked 2026-10-18).

## Recommendation

**A, with React Aria Components for the date picker, calendar, and dialog or drawer only,** each behind a wrapper component (ARCH-8). Tokens come from Figma variables through one export step, so Figma and code share names. Storybook covers the six P3 primitives plus the booking bar and filter drawer, with its accessibility addon, and its build runs in CI (SET-12). **Code Connect (amended 2026-10-18 at Dave's request):** the design system is built as a proper Figma library in P3 (variables, then components with variants whose names and properties match the planned code props). A Code Connect spike runs in P4 on a throwaway branch: one primitive coded and published with the Code Connect CLI, to learn the workflow and estimate the real unit. The full mapping is a P5 unit once the primitives are coded. Code Connect needs a Full or Dev seat on a Professional, Organization, or Enterprise plan; Professional allows one library and one framework, enough for Ramble ([Figma help](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect), checked 2026-10-18).

House rule for presentation logic (BUILD-PLAN seam 3): a decision about what to show is a plain function in `lib/` (ARCH-1). A custom hook is only for stateful logic shared by components (STATE-12). Don't wrap a pure computation in a hook.

## Token naming contract (PM note, added 2026-10-18 at Dave's approval of the P3 design system plan)

The token export must emit CSS custom properties named exactly as the Figma variables, with `/` replaced by `-` and a `--` prefix: `color/bg/canvas` becomes `--color-bg-canvas`, `space/4` becomes `--space-4`, `font/size/heading-l` becomes `--font-size-heading-l`. Every Figma variable carries that name as its WEB code syntax (`var(--color-bg-canvas)`), so Dev Mode, the Figma MCP tools, and Code Connect show the same names the CSS uses.

- **Collections:** `Primitives` (raw palette, `--palette-…`, never used by components directly); `Color` with Light and Dark modes, mapped to `prefers-color-scheme`; `Space`; `Radius`; `Type` with Mobile and Desktop modes, Desktop applying at `min-width: 768px`. Breakpoints are not tokens, since media queries can't read custom properties.
- **Shadows:** Figma effect styles `elevation/1` to `elevation/3`, emitted as `--elevation-1` to `--elevation-3` box-shadow values, with their color from `--color-shadow`.
- **Text styles:** bound to the `Type` variables, so components use the style names and code uses the matching size and line-height properties.
- **Components:** Figma variant and property names match the React props (`variant`, `size`, `state` and so on), so Code Connect maps them one to one.
- The full variable list is in `docs/design/design-system-plan.md`. A rename in Figma is a breaking change for code and needs a matching change in the export.

## Editorial content management (R11, folded in 2026-10-18)

Dave folded R11 into this ADR rather than opening a new one. PM note, not separately researched.

- **Driving requirements:** PRD-01 (home modules the team arranges without a developer), PRD-03 (Ramble Picks), PRD-04 (gift guide), PRD-13 (guide pages), PRD-50 (approval and editorial editing), PRD-65 (editorial copy on category and neighborhood pages), C-04 (no engineers).
- **Approach:** an in-app editorial admin inside the ops route group (ADR 0001), storing content in the same Postgres database (ADR 0002). Home modules are configuration rows (type, order, collection, copy), per the 2026-09-16 decision that home is the discovery surface built from config-driven modules. Rich text uses a constrained structured format rendered on the server and sanitized (SEC-6). Publishing revalidates the cache tags for the affected pages (ADR 0001).
- **Not at launch:** a hosted CMS. Scheduling, drafts with preview links, and multi-step editorial workflow are out of scope until the team asks for them.
- **What would change it:** the editorial team needs scheduled publishing, preview links, or roles beyond publish and edit: a hosted or self-hosted CMS (for example Sanity, Contentful, or Payload) behind a wrapper module (ARCH-8).

## What would change the call

- Dave prefers Tailwind for agent speed: B is a sound choice; record UI-2 as Tailwind and put tokens in `@theme`.
- The designer delivers a full component kit that maps to an existing library: revisit C.
- React Aria's bundle cost shows up in PRD-68 lab runs: replace the one heavy widget, not the approach.
