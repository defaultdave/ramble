# Experience page

How `/experiences/[slug]-[id]` is built, what it shows and when a section hides, how it is cached, and what the guest sees when something is missing or a read fails. The decisions are in ADR 0001 (Cache Components) and the cache rules in [cache-conventions.md](cache-conventions.md). The page covers PRD-09 to PRD-12 and PRD-68. The upcoming dates, spaces left, and the booking bar, sheet, and panel are other units' (they leave `TODO(U-040)` and `TODO(U-041)` in `ExperiencePage`).

## The address

The address ends with the experience's ID after a hyphen. `parseExperienceAddress` (`src/lib/routes.ts`, beside `experiencePath`, which writes it) splits it; the ID is the key, and the slug is checked for shape only, so a slug that has changed still finds its experience. An address that is not a slug and an ID is a 404 before anything is read. A guide entry (`guide_only`) has its own page and is a 404 here. `generateStaticParams` returns `sample`, which is not an address, so the build prerenders a 404 shell and never reads the database.

## What is shown

`buildExperiencePage` decides everything the page says; `ExperiencePage` only draws it.

| Part | Comes from | Hidden when |
|---|---|---|
| Breadcrumb (from the tablet width), badges | Neighborhood and category; Outdoor, 21+, Kids (a child price) | A badge when it does not apply |
| Gallery | The experience's photos in position order | Never: with no photo it shows a placeholder of the same size |
| Price | The price options, adults first; one price reads "per person", two read "per adult" and "per child"; nothing reads "Free" | There is no price option |
| Key facts | Neighborhood, length, age rule, weather call, cancellation window | Length when unknown; weather for an indoor experience |
| About, What's included | Description and included text, one entry per line | The text is blank |
| Your host | Host name and description, with an initial in place of a photo | Never |
| Meeting point | The text, and an "Open in Maps" link that searches its first sentence in New York | The text is blank; the link when the first sentence is longer than 200 characters |
| Accessibility | Accessibility notes | The notes are blank |
| Weather | The weather policy of an outdoor experience (PRD-12) | The experience is indoor |
| Cancellation | The tier's window, in hours or, from two days, in days | Never |
| Gift and private session | "Give this as a gift" goes to `/gifts/checkout/<id>`; "Ask about a private session" goes to `/contact` | The gift entry while gifts are switched off in settings |

The cancellation terms are stated by window (`cancellationTerms`). The deadline for one session comes from `cancellationWindow` when a session is picked, which is the booking units' step.

## Cache

| Function | File | Profile | Tags |
|---|---|---|---|
| `getExperiencePage(id)` | `src/server/experiencePage.ts` | `catalog` | `experience:<id>`, `catalog` |
| `getCachedGuestSettings()` | `src/server/siteSettings.ts` | `settings` | `settings` |

Both are inside the prerendered shell (their `expire` is over five minutes). A hidden or missing experience, and an ID that is no guid, return `null` under the `uncached` profile (`expire: 0`), so a production build keeps nothing and made-up IDs fill no cache. Each such request reads the database again, up to twice (the metadata and the page both ask). `next dev` keeps the entry, so check this against a production build. Publishing, editing, or taking an experience down reaches the entry through `tagsForChange`.

The lead photo goes through `next/image` preloaded (`next/image`'s `preload`) with its blur placeholder; every photo sits in a frame with a fixed aspect ratio, so nothing shifts when it loads (PRD-68). There is no client island: the phone gallery is a scroll-snap strip, and "See all" is a native `<details>`.

## When a read fails

A failed read renders the heading "Experience", a danger alert ("We couldn't load this experience"), and a Try again button, a GET form to the page's own address. Only the digest and the kind of the error are logged (`digest` and `kind` fields, through `rethrowOrLog`). The head falls back to the plain title and logs the same way, so a failed experience read logs twice per request, once from the head and once from the page.

## What the e2e run covers

The e2e server has no database. `e2e/experience.spec.ts` covers the 404 for `/experiences/sample`, the error state and its retry for a well-formed address, and that neither scrolls sideways at 320px. The page itself is covered by the component tests, the stories, and the route test.
