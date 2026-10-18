# ADR 0008: Seed content

- **Status:** Accepted 2026-10-18 (Dave), as recommended.
- **Date:** 2026-10-18
- **Question:** R8 in `docs/plan/BUILD-PLAN.md`
- **Depends on:** ADR 0002 (schemas and the seed script)

## Context

The demo has no real hosts (C-09). The seed has to make the site look like Ramble, exercise every state the PRD defines, and be large enough to test performance and load. The build plan's starting point is 40 to 60 experiences across 8 categories and a few neighborhoods, with licensed or generated images and generic copy. The prior client's names, copy, and URL shapes are off limits.

## Driving requirements

| ID | Why it matters here |
|---|---|
| G1 | The real target is about 150 hosts and 400 experiences; performance tests need that volume |
| PRD-09, PRD-65, PRD-77 | Rich experience pages and editorial category and neighborhood copy in Ramble's voice |
| PRD-12, PRD-23, PRD-46, PRD-78 | Outdoor and weather policies, 21+ and kids' rules, every cancellation tier, each tax treatment |
| PRD-13, PRD-42 | Guide-only listings; hosts on allocations as well as hosts managed on Ramble |
| PRD-16, PRD-21 | Sessions with one space left and sold-out sessions |
| PRD-33 | Giftable experiences |
| PRD-50, PRD-52 | Photos at least 1,600 px on the long edge, with a rights record |
| PRD-68, PRD-70 | Realistic page weight and data volume for lab and load tests |

## Options for images

**A. Licensed stock photos** (Unsplash or Pexels, whose licenses allow free commercial use without attribution: [Unsplash license](https://unsplash.com/license), [Pexels license](https://www.pexels.com/license/), checked 2026-10-18; neither allows selling unmodified copies, and Pexels bars implying endorsement by people or brands shown). Real photos look like a real marketplace. Each image is recorded in a seed manifest with its source URL and license, which models PRD-52's rights record.

**B. Generated images.** Consistent style and no rights lookup, but they read as fake on a marketplace whose pitch is real local places, and generated people and storefronts invite scrutiny.

**C. Illustrations only,** from the brand's illustration style. Cheap and on brand, but PRD-09 calls for photos and illustrations alone don't test image performance.

## Options for volume

**1. A curated demo set only** (about 60 experiences). Looks good, but too small to test PRD-68 and PRD-70 honestly.

**2. A curated demo set plus a generated scale fixture.** The curated set is what people see; a script generates about 400 experiences from 150 hosts with plausible variety, used only for performance and load tests.

## Recommendation

**Images A, volume 2.**

- **Curated set:** about 60 experiences from about 30 fictional hosts, in 8 categories drawn from the brief's host mix: ceramics and crafts, cooking, walking tours, wine and cocktails, food and coffee tastings, outdoor (kayak and bike), wellness (yoga and sound bath), and kids. Spread across about 6 Brooklyn and Manhattan neighborhoods (real place names, fictional businesses). Plus about 20 guide-only listings (PRD-13). Sessions generated 8 weeks ahead.
- **Coverage:** a matrix assigns at least one curated experience to every state in the driving requirements, so each P3 state has real data behind it.
- **Copy:** written fresh in Ramble's voice, reviewed against the PRD-77 tone checklist. No real business names, no text from the prior client's work.
- **Images:** Unsplash or Pexels at 1,600 px or more, listed in a manifest (file, source URL, license, photographer), served through `next/image`.
- **Format:** typed fixtures validated by the same schemas as the app (DATA-4), loaded by one seed script into the database (ADR 0002).

## What would change the call

- The stock library has no usable photos for a category: generate those few, labelled as illustrative in the manifest.
- P3 design calls for an illustration-led style: shift some modules to C.
- The load test needs more than the scale fixture provides: grow the generator, not the curated set.
