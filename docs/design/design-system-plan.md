---
title: Ramble design system plan (Figma library)
date: 2026-10-18
author: ramble-pm
status: approved 2026-10-18 (Dave): plan as written, direction A, stand-in brand assets, Lucide icons
sources: ADR 0005; docs/design/wireframe-review.md; PRD-67, PRD-69, PRD-77; figma-generate-library skill
---

# Ramble design system plan

Builds the Figma library for P3 before the mobile flow, so every screen is drawn from it (BUILD-PLAN P3 note, ADR 0005). Nothing is built until Dave approves this plan and picks a visual direction.

## Starting point

- **File:** "Ramble Core Flow Wireframes", in a team project on Dave's Professional plan, so it can be published as the library. Today it has one page (the v0 desktop flow), no variables, no styles, and no components.
- **Subscribed kits:** Figma's community kits (Material 3, Simple Design System, Apple OS kits) are attached by default. Not used: ADR 0005 rejected a component kit because a generic look fights PRD-77.
- **Code:** none yet. ADR 0005 says Figma variables feed a token export that becomes CSS custom properties, but it does not name them. **This plan sets the names**, and the token export in P5 must emit exactly these.
- **Plan limits:** Professional allows 4 modes per variable collection (we use 2) and one active Code Connect library (this file).

## Scope and acceptance

**In scope:** variables, text and effect styles, a Foundations page, and the component inventory below, each with variants, properties, and variable bindings.
**Out of scope:** Code Connect mappings (P4 spike, then P5), the mobile flow and states pages (next P3 steps), host and ops components, and real brand assets (see decision 3).

**Done when:**
1. Every variable has a scope (never all scopes; primitives hidden) and WEB code syntax `var(--…)` matching the contract below.
2. Every text-on-background pair in both modes passes WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text, borders that identify controls, and the focus ring (PRD-69). Checked by script before building and spot-checked in Figma after.
3. Component fills, strokes, padding, gaps, and radii are bound to variables; text uses the text styles.
4. Interactive components are at least 44 px tall on mobile (WCAG 2.2 asks for 24; 44 suits thumbs and the iPhone-heavy audience, PRD-67).
5. Variant and property names match the planned React props, so Code Connect maps them one to one.
6. Each component page shows its variants as instances in one review frame, checked by screenshot in both modes.

## Naming contract: Figma variable to CSS custom property

Rule: the CSS name is the Figma path with `/` replaced by `-`, prefixed `--`. Code syntax is set on every variable, for example `color/bg/canvas` gets `var(--color-bg-canvas)`.

### Collections

| Collection | Modes | Holds | Scopes |
|---|---|---|---|
| `Primitives` | Value | Raw palette ramps, for example `palette/ink/900`, `palette/tomato/600` | Hidden (`[]`); code syntax `var(--palette-…)` |
| `Color` | Light, Dark | Semantic colors, each an alias of a primitive | Per role (below) |
| `Space` | Value | Spacing on a 4 px base | `GAP`, padding |
| `Radius` | Value | Corner radii | `CORNER_RADIUS` |
| `Type` | Mobile, Desktop | Font families, sizes, line heights, weights | Font properties |

Color modes map to `prefers-color-scheme` (UI-10). Type modes map to one `min-width` breakpoint (UI-3): Mobile is the default, Desktop applies at 768 px and up. Breakpoints themselves are not tokens, because CSS media queries can't read custom properties.

### Semantic color

| Figma variable | CSS custom property | Used for | Scope |
|---|---|---|---|
| `color/bg/canvas` | `--color-bg-canvas` | Page background | Frame fill |
| `color/bg/surface` | `--color-bg-surface` | Cards, sheets, inputs | Frame and shape fill |
| `color/bg/sunken` | `--color-bg-sunken` | Recessed sections, image placeholders | Frame and shape fill |
| `color/bg/inverse` | `--color-bg-inverse` | Footer, toasts | Frame fill |
| `color/bg/accent-subtle` | `--color-bg-accent-subtle` | Hold banner, selected chip | Frame fill |
| `color/bg/highlight` | `--color-bg-highlight` | Sticker-style labels, editorial flourishes | Frame and shape fill |
| `color/text/primary` | `--color-text-primary` | Body and headings | Text fill |
| `color/text/secondary` | `--color-text-secondary` | Meta lines, hints | Text fill |
| `color/text/inverse` | `--color-text-inverse` | Text on inverse | Text fill |
| `color/text/link` | `--color-text-link` | Links | Text fill |
| `color/text/on-accent-subtle` | `--color-text-on-accent-subtle` | Text on accent-subtle | Text fill |
| `color/text/on-highlight` | `--color-text-on-highlight` | Text on highlight | Text fill |
| `color/action/primary/bg` (plus `-hover`, `-pressed`) | `--color-action-primary-bg` | Primary button | Frame fill |
| `color/action/primary/text` | `--color-action-primary-text` | Primary button label | Text fill |
| `color/border/default` | `--color-border-default` | Dividers, card edges (decorative) | Stroke |
| `color/border/strong` | `--color-border-strong` | Input and chip edges (3:1, they identify controls) | Stroke |
| `color/focus/ring` | `--color-focus-ring` | Focus indicator | Stroke |
| `color/status/{danger,warning,success,info}/{bg,text}` | `--color-status-danger-bg` and so on | Alerts, errors, hold warning | Fill, text fill |
| `color/tag/{green,yellow,blue,pink}/{bg,text}` | `--color-tag-green-bg` and so on | Badges: Outdoor, 21+, Kids, Step-free | Fill, text fill |
| `color/shadow` | `--color-shadow` | Shadow color inside elevation styles | Effect color |

### Space, radius, elevation, type

| Group | Figma variables | CSS | Values |
|---|---|---|---|
| Space | `space/1` … `space/16` | `--space-1` … | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (steps 1, 2, 3, 4, 5, 6, 8, 10, 12, 16) |
| Radius | `radius/sm`, `radius/md`, `radius/lg`, `radius/pill` | `--radius-sm` … | 6, 12, 20, 999 |
| Elevation | Effect styles `elevation/1` to `elevation/3`, shadow color bound to `color/shadow` | `--elevation-1` … (box-shadow values in the token export) | Card rest, sticky bar, sheet |
| Type families | `font/family/display`, `font/family/body` | `--font-family-display`, `--font-family-body` | Per direction |
| Type sizes | `font/size/{display-l, display-m, heading-l, heading-m, heading-s, body-l, body-m, body-s, label, caption}` and matching `font/line-height/…` | `--font-size-display-l` … | Mobile: 40, 32, 24, 20, 17, 18, 16, 14, 14, 12. Desktop: 64, 48, 32, 24, 18, then body sizes unchanged |
| Weights | `font/weight/{regular, medium, semibold, bold}` | `--font-weight-…` | 400, 500, 600, 700 |

Text styles (Display L, Display M, Heading L/M/S, Body L/M/S, Label, Caption) are bound to these variables, so switching the Type mode resizes them.

## Components (v1 inventory)

The nine from the brief, plus seven they depend on (marked +). Variant and property names are written the way the React props will be, so the P4 spike and P5 mapping are mechanical. Figma-only states (hover, focus) have no prop.

| Component | Variants | Other properties | Needed by |
|---|---|---|---|
| + Icon set | One component per icon, used through instance swap | n/a | All. Lucide icons, ISC license, matching `lucide-react` in code (decision 4) |
| Button | `variant` primary, secondary, ghost; `size` md, lg; `state` default, hover, focus, disabled, loading (30) | `label`, `iconStart` (swap), `showIcon` | Everywhere |
| Input | `state` default, focus, error, disabled | `label`, `hint`, `errorText`, `optional`, `value` | 05, 02b |
| + Checkbox | `checked` true, false; `state` default, focus, error, disabled | `label`, `description` | 05 (opt-in, terms, waiver, 21+), 02b |
| Chip | `selected` true, false; `state` default, focus, disabled | `label`, `count`, `iconStart` | 02 filters, 02b |
| + TimeSlot | `state` open, few-left, sold-out, selected, focus | `time`, `note` ("2 left") | 04 |
| + Badge | `tone` green, yellow, blue, pink, neutral | `label`, `icon` | Cards, 03 |
| + Stepper | `state` default, at-min, at-max, disabled | `label`, `value`, `hint` | 04 (party; adults and children) |
| Card | `layout` vertical, horizontal; `kind` bookable, guide-only | `showRating`, `showBadge`, `title`, `meta`, `price` | 01, 02, 06 |
| Header | `variant` default, checkout | `showGifts`, hold timer slot | All screens |
| + Footer | one | link groups | All but checkout |
| + HoldTimer | `state` running, warning, expired | `time` | 05 |
| + Alert | `tone` info, success, warning, danger | `title`, `body`, `action` | States page, 05 |
| Order summary | `kind` booking, gift; `expanded` true, false | `showTax` | 05, 06 |
| Booking bar | `state` default, date-chosen, sold-out | `price`, `nextDate` | 03 |
| Date picker | `_DatePicker/Day` cell: `state` available, unavailable, selected, today, focus; Calendar month built from cells | `month` | 04, 02b |
| Filter drawer | `platform` mobile (bottom sheet), desktop (side panel) | filter groups as slots | 02b |

The booking sheet (screen 04) is assembled in the flow from Date picker, TimeSlot, Stepper, Order summary, and Button, not built as a component.

## File structure

Pages, added in this order: `Cover`, `---`, `Foundations` (color, type, space, radius, elevation specimens in both modes), `Icons`, `---`, one page per family (`Buttons`, `Inputs` with Input, Checkbox, Stepper; `Chips and badges` with Chip, TimeSlot, Badge; `Cards`; `Navigation` with Header, Footer, Booking bar; `Booking` with Date picker, HoldTimer, Order summary; `Overlays` with Filter drawer; `Feedback` with Alert), `---`, then the flow pages from the next P3 steps, and the existing `Core flow (desktop)` last. The v0 page is not changed.

## Build order and effort

1. Foundations: primitives, semantic color in two modes, space, radius, type, text and effect styles, with code syntax and scopes. Two or three scripted calls, then a structural check.
2. Cover and Foundations pages, one visual check.
3. Icons, then components in dependency order: Button; Input, Checkbox, Stepper; Chip, TimeSlot, Badge; Alert, HoldTimer; Card; Header, Footer; Order summary; Booking bar; Date picker; Filter drawer. One call per component page plus one screenshot each.

Rough size: about 25 to 35 Figma calls. All calls run one at a time; a state ledger in the scratchpad records every created ID so a later session can resume.

## Visual direction

Three directions. Each passes AA in light and dark on 19 core pairs: body and secondary text on canvas, surface, and sunken; links; button label on action; action on canvas; text on accent-subtle, highlight, and a green tag; strong border and focus ring at 3:1; danger and success text (checked by script 2026-10-18). The remaining status and tag colors get the same check before the build. Fonts are Google Fonts, available in Figma and in code through `next/font`.

| | A. Sunday paper (recommended) | B. Stoop poster | C. Evening walk |
|---|---|---|---|
| Feel | A weekend newspaper: cream paper, warm ink, tomato red, marigold stickers | A gig poster: butter yellow, navy ink, cobalt, pink and marigold pops | A quiet magazine: warm stone, deep green, apricot |
| Display font | Fraunces (soft serif with playful shapes) | Bricolage Grotesque (quirky grotesque) | Instrument Serif |
| Body font | Inter | DM Sans | Figtree |
| Action color | Tomato `#B93A22`, white text | Cobalt `#2B44C7`, white text | Forest `#24543D`, white text |
| Canvas | `#FBF6EE` / dark `#18130F` | `#FFF7E3` / dark `#0E1428` | `#F7F4EC` / dark `#121814` |
| Lowest text contrast | 5.7 light, 7.4 dark | 6.3 light, 6.6 dark | 5.7 light, 7.0 dark |
| Why | Closest to "playful, warm, editorial" (PRD-77) and to Ramble's start as a Sunday newsletter; the serif carries editorial pages (PRD-65) | Most playful; least editorial; louder against photography | Most editorial and calm; least playful; near v0's teal |

## As built (2026-10-18)

Built in the Figma file the same day, from this plan. IDs are in `figma-library.json`.

- **Variables:** 127 (Primitives 48, Color 38, Space 11, Radius 4, Type 26). None is left at "all scopes"; every one has WEB code syntax `var(--…)`. Light and Dark pass AA on every text pair checked (68 pairs; lowest text ratio 5.1 light, 7.4 dark). The focus ring is drawn 2 px outside the control with a canvas-colored gap, so it is checked against the page, not the button.
- **Styles:** 12 text styles bound to the Type variables, 3 elevation styles bound to `color/shadow`.
- **Pages:** Cover, Foundations, Icons and brand, Buttons, Inputs, Chips and badges, Cards, Navigation, Booking, Overlays, Feedback. Each component page has a Light and Dark review frame. The v0 desktop page is untouched and sits last.
- **Components:** Button, Input, Checkbox, Stepper, Chip, TimeSlot, Badge, Alert, Card, HoldTimer, DatePicker (with internal `_DatePicker/Day`), OrderSummary, Header, Footer, BookingBar, FilterDrawer, plus the stand-in Logo and Illustration and 26 icons.

**Differences from the plan above** (all small; none changes a decision):
- Added variables `color/bg/disabled`, `color/text/disabled`, and `size/touch-target` (44), and the text style `Caption/Strong` for badges.
- Status colors use a berry red for danger, kept apart from the tomato action color, and every error pairs an icon with text.
- State-specific text (TimeSlot note, HoldTimer and Alert copy, BookingBar lines) is set per instance rather than as a shared text property, because a shared property would show the same text in every state.
- Added after the mobile flow: `Skeleton` (card, horizontal card, text) for loading states, sized to match the real cards so nothing shifts when content loads (PRD-68). The Stepper text column was fixed so long hints wrap.
- Desktop revision (2026-10-18): BookingPanel added (desktop replacement for the booking bar and sheet); Header gained a `platform` property with desktop variants; Footer became a set with a desktop variant; new variable `size/content-max` (1200, `--size-content-max`). FilterDrawer already had its desktop side panel.
- Not done here: publishing the library (Dave, in Figma) and Code Connect (P4 spike). The cover could not be set as the file thumbnail through the API; Dave can set it by hand.

## Decisions for Dave

> **Decided 2026-10-18 (Dave):** all five as recommended, direction A.

1. **Approve this plan:** five collections with Light and Dark color modes and Mobile and Desktop type modes, the naming contract, and the 16-component inventory (the brief's nine plus seven they depend on). Recommended.
2. **Visual direction:** A, Sunday paper (recommended), B, or C.
3. **Brand assets:** the freelance designer's logo and illustrations (PRD-77) don't exist in this demo. Recommended: a stand-in wordmark in the display font and an `Illustration` slot component, so real assets replace them by instance swap. Alternative: commission or generate stand-in illustrations now.
4. **Icons:** Lucide (ISC license), which `lucide-react` mirrors in code, so Code Connect maps icon to icon. Recommended over drawing a custom set.
5. **Record the naming contract in ADR 0005** as a PM note once approved, so the P5 token export is held to it.
