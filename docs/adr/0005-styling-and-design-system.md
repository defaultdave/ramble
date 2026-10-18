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

**A, with React Aria Components for the date picker, calendar, and dialog or drawer only,** each behind a wrapper component (ARCH-8). Tokens come from Figma variables through one export step, so Figma and code share names. Storybook covers the six P3 primitives plus the booking bar and filter drawer, with its accessibility addon, and its build runs in CI (SET-12). Figma Code Connect waits until the primitives are stable and the Figma plan is confirmed to include it.

House rule for presentation logic (BUILD-PLAN seam 3): a decision about what to show is a plain function in `lib/` (ARCH-1). A custom hook is only for stateful logic shared by components (STATE-12). Don't wrap a pure computation in a hook.

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
