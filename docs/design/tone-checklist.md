---
title: Ramble tone checklist for the design sign-off
date: 2026-10-18
author: ramble-pm
status: signed off 2026-10-18 (Dave, as the client), with the B3 waiver
requirement: PRD-77 (brand: playful, warm, editorial; the founder or someone she names approves the mobile design against a written tone checklist)
sources: client brief (B§1, B§2, B§7, B§9); PRD-77 and the requirements cited below; docs/design/design-system-plan.md
---

# Tone checklist

The founder said she would give up the native app, wishlists, and day-one reviews before she gave up "brand and editorial feel" (B§9). This checklist turns that feel into things a reviewer can check on a screen, so the sign-off is a judgment against criteria rather than a mood.

## How to use it

- **Who signs:** the founder, or someone she names (PRD-77). In this demo Dave signs as the client, as he did for the PRD.
- **What is reviewed:** the Figma pages "Core flow (mobile)" (screens 01 to 08 and their variants) and "States" (S1 to S10), in light and dark.
- **How:** mark each item Pass, Fix, or Waive. Any Fix blocks the sign-off. A Waive needs a reason and goes in `docs/plan/DECISIONS.md`.
- **Out of scope here:** whether a feature should exist. That was settled in the PRD. This checks how it looks and sounds.

## The brand in one line

Ramble is "the friend who always knows what to do in Brooklyn" (B§1). It started as a Sunday newsletter, and its readers arrive from that email on a phone. The site should read like that friend's recommendation, look like a good weekend paper, and never feel like "just another Viator" (B§2).

## A. Voice

| # | Check | Where to look | PM pre-check |
|---|---|---|---|
| A1 | **Sounds like a friend's tip, not a listing.** Second person, contractions, and specifics: the neighborhood, what you'll actually do, what's included. | 01 hero, 02 intro, 03 About | Pass ("Paddle out as the light goes gold") |
| A2 | **Editorial, with a point of view.** Headlines say something ("Give a Saturday, not a sweater", "Rainy day, sorted"). Collections and category pages open with a short intro written by a person (PRD-03, PRD-65). | 01 modules, 02 intro, 03b | Pass |
| A3 | **Playful only where it's safe.** Wit lives in headlines, module intros, and gift moments. Prices, policies, errors, waivers, and buttons are plain. | 05, 07, S3 to S10 | Pass |
| A4 | **Honest about money.** Price per person on the page; one total before paying that equals the charge; tax as its own line when charged; no fees (PRD-19, Q-03). "From" only when prices differ between sessions. | 03, 04, 05, 06 | Pass, with one note: cards say "From $65" for a single-price experience. Use "From" only for variable prices in the seed data |
| A5 | **Honest about rules.** Cancellation terms in plain words with a real date and time, before checkout and again at Pay (PRD-10). Weather and age rules said once, clearly (PRD-12, PRD-23). | 03, 04, 05, 07 | Pass |
| A6 | **No pressure tricks.** "2 left" only when true; the only countdown is the real hold (PRD-16); no "people are looking", no fake deadlines, no pre-ticked boxes (PRD-15, PRD-73). This is also the COO's worry: the site must not promise what hosts can't deliver (B§2). | 03, 04, 05 | Pass |
| A7 | **Problems in plain words.** Every error or state says what happened, what is safe (not charged, hold kept, details saved), and the one next step. No blame, no "Oops", no error codes. | S3 to S10 | Pass |
| A8 | **Buttons say what happens.** Verb first; money actions show the amount ("Pay $130.00", "Cancel and refund $130.00"). | 04, 05, 07, S6 | Pass |
| A9 | **Local and specific, never generic.** Real NYC neighborhoods and places; none of the travel-marketplace stock phrases (see the word list). | All | Pass |
| A10 | **Mechanics.** Sentence case everywhere; dates as "Sat, Oct 24"; times as "5:30 PM"; money as "$65" and "$130.00" for totals; no exclamation marks in Ramble's own copy (a guest's gift message may have them). | All | Pass |

**Words to avoid:** unforgettable, curated adventures, seamless, hassle-free, unlock, elevate, bucket list, hidden gem, book now before it's gone, limited time, oops, successfully.

**Words that sound like Ramble:** this weekend, near you, worth it, slow morning, our favorite, small group, real kitchen, you'll, we'll.

## B. Look

| # | Check | Where to look | PM pre-check |
|---|---|---|---|
| B1 | **Type carries the editorial voice.** Fraunces for headlines and editorial moments; Inter for everything you read to act (prices, forms, policies). No Fraunces below 17 px. | All | Pass |
| B2 | **Color is warm and has jobs.** Cream paper and warm ink; tomato only for the main action and links, one primary button per view; marigold only for Ramble Picks and editorial stickers; status colors only for status. | All | Pass |
| B3 | **The logo and illustrations are the designer's** and appear on guest pages and emails (PRD-77): the logo on every page; illustrations at moments that deserve warmth (home, empty results, confirmation, gifts), never in the middle of a form. | 01, 06, 06b, 08, S2 | **Waive needed.** The wordmark and illustrations are stand-ins until real assets exist; placement is right, artwork is not |
| B4 | **Photos show the real thing.** People doing the actual experience, natural light, at least 1,600 px; no screenshots or app chrome (PRD-50). | 01, 02, 03 | **Not judgeable yet.** Photos are placeholders; checked again with the seed photos (ADR 0008) |
| B5 | **Room to breathe.** One idea per section, generous spacing, nothing crammed above the fold to sell. | All | Pass |
| B6 | **Not a generic marketplace.** No star-heavy grids, deal badges, or banner countdowns; ratings appear only once real reviews exist (PRD-32). | 01, 02, 03 | Pass |
| B7 | **Dark mode is just as warm.** Warm black and cream text, not blue-gray; the same hierarchy as light. | Library review frames | Pass |

## C. Warm means usable

| # | Check | Where to look | PM pre-check |
|---|---|---|---|
| C1 | Text passes WCAG 2.2 AA in light and dark (PRD-69). | Foundations page | Pass (68 pairs checked; lowest 5.1 light, 7.4 dark) |
| C2 | Body text at 16 px or more; nothing a reader needs below 12 px. | All | Pass |
| C3 | Everything you tap is at least 44 px tall. | All | Pass |
| C4 | No meaning carried by color alone: errors have an icon and words; sold out is struck through and labeled. | 04, S3 to S10 | Pass |

## PM pre-check summary (2026-10-18)

- **Passes:** A1 to A10, B1, B2, B5 to B7, C1 to C4, with one copy note on A4 ("From" pricing).
- **Needs a waiver at sign-off:** B3, the stand-in wordmark and illustrations. Recommended wording: "Approved with stand-in brand assets; the designer's logo and illustrations replace them by instance swap before launch."
- **Deferred:** B4, photography, judged when the seed photos arrive.
- **Fixed during the pre-check:** three state frames carried design notes ("Scrolled to payment") styled like product copy. The notes moved into the frame labels.
- **Open copy placeholder:** "Presented by our holiday partner" on the home gift module waits on the sponsor contract (Q-13).

## Sign-off

| Role | Name | Date | Result | Waivers |
|---|---|---|---|---|
| Founder or named approver | Dave, as the client | 2026-10-18 | Approved: the mobile flow (Core flow (mobile), 01 to 08 with variants) and the States page (S1 to S10) | B3 waived: stand-in wordmark and illustrations, to be replaced by the designer's assets by instance swap before launch. B4 deferred: photography judged with the seed photos (ADR 0008) |
