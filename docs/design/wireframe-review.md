---
title: v0 desktop wireframe review against the signed PRD
date: 2026-10-18
author: ramble-pm
status: decided 2026-10-18 (Dave adopted all four recommendations; see docs/plan/DECISIONS.md)
sources: Figma "Ramble Core Flow Wireframes", page "Core flow (desktop)" (frames 2:6, 2:179, 3:2, 3:133, 3:253, 3:382 and their notes), read with get_metadata and get_screenshot, not changed; docs/product/PRD.md v1.0; ADRs 0001 to 0010
---

# v0 desktop wireframe review

The v0 frames were drawn on 2026-09-28, before the PRD. This review checks them against PRD v1.0 and the accepted ADRs, then proposes the six mobile screens for P3. The v0 page stays as it is; it is content inventory.

## Summary

- **The v0 flow is a generic cart flow.** Home, search, detail, cart, checkout, and confirmation. The signed PRD has no cart (section 5), no buyer fee (Q-03), no PayPal (PRD-18), no map (PRD-08, ADR 0004), no wishlists (PRD-38), and no reviews at launch (Q-09). All six appear in v0.
- **What carries over well:** home as config-driven modules (PRD-01), URL as state (ADR 0004), sold-out and low-stock time slots, the hold timer idea, the single-page checkout with the total on the Pay button and an idempotent submit (PRD-19, PRD-22), and a refresh-safe confirmation with add to calendar and manage booking (PRD-25, PRD-26).
- **What the PRD needs that v0 lacks:** gift purchase (PRD-33) and the gift guide (PRD-04), guide-only pages (PRD-13), the host on the experience page (PRD-09), age rules and waivers (PRD-23, PRD-24), outdoor labels and weather policy (PRD-12), the newsletter opt-in (PRD-15), the tax line (PRD-19, PRD-78), category and neighborhood pages with editorial copy (PRD-65), and the phone booking bar (PRD-11, noted in v0 but not drawn).
- **Brand:** v0 is neutral lo-fi (gray boxes, teal accent, a text wordmark). Nothing yet is playful, warm, or editorial (PRD-77). The library sets that.
- **Proposed mobile flow:** six screens with variants. The cart is replaced by a "choose date and party" sheet (04), and gifting runs through the same flow as variants of 04, 05, and 06.

## Cross-cutting findings

These show on every v0 frame, so they are listed once.

| v0 element | Conflict or gap | Source | Mobile change |
|---|---|---|---|
| Header "Cart (2)" | No cart at launch | PRD section 5, PRD-14 | Remove |
| Header "Gift cards" | Gift cards are a Should, first in the cut order (working assumption: the sponsor does not need them) | PRD-34, ADR 0003 | "Gifts", linking to the gift guide (PRD-04), which sells experiences as gifts (PRD-33) |
| Header "Sign in" | Accounts are a Should, second in the cut order; booking never needs one | PRD-15, PRD-37 | Design without it; leave a menu slot that appears if PRD-37 ships |
| "Rated 4.9 (212)" on every card, and "Reviews 4.9 from 212" | Reviews are never imported; display starts at 5 verified reviews, so launch shows none | Q-09, PRD-29, PRD-32 | Card and page variants with and without a rating; the no-rating variant is the launch default |
| Trust strip "Card, Apple Pay, Google Pay or PayPal" | PayPal is not a payment method | PRD-18 | Drop PayPal |
| Trust strip "Tickets land in your inbox the moment you pay" | The promise is within 5 minutes | PRD-25 | Softer copy, written to the tone checklist |
| Footer "List an experience" | Host self-serve sign-up is Later; onboarding is white-glove | PRD-49, PRD-39 | "Host with Ramble", leading to a contact or interest page |
| Footer has no Terms or Privacy | Terms and privacy must be published and reachable | PRD-53 | Add to the main footer (checkout's mini footer has them already) |
| Map placeholders on search and detail | No map at launch; meeting point as text with a link to the guest's map app | PRD-08, ADR 0004 | Remove maps; "Open in Maps" link |
| Desktop 1440 only | Designed at 390 first | PRD-67 | That is the P3 job |
| Light gray secondary text, sold-out chip text | Contrast not checked; likely under 4.5:1 for the price and rating lines | PRD-69 | Library sets text colors that pass AA in both schemes; sold-out stays readable |
| Gray boxes, text wordmark, no illustrations | Brand not present | PRD-77, C-07 | Library and visual direction (step 3) |

## Frame by frame

### 01 Home (2:6)

- **Covers:** home as the discovery surface built from modules (PRD-01): hero search (where, when, who, what), category rail (8 categories), "Popular near Brooklyn" cards, one collection ("Rainy day picks", effectively a Ramble Pick, PRD-03), recently viewed, trust strip, footer. Note: empty modules hide.
- **Missing:** gift guide module and sponsor placement (PRD-04, Q-13); a Ramble Picks module named as such with a link to its own page (PRD-03); keyword search (PRD-07, Should); any guide-only content (PRD-13).
- **Contradicted:** header and trust strip items above.
- **No PRD ID:** "Recently viewed" (needs client-side storage and adds client JavaScript against PRD-68). Suggest it stays out of the launch design and goes to Suggestions.
- **Category list:** v0 has Food & drink, Outdoors, Classes, Wellness, Nightlife, Tours, Arts, Family. ADR 0008's seed uses ceramics and crafts, cooking, walking tours, wine and cocktails, food and coffee tastings, outdoor, wellness, and kids. Nightlife has no hosts in the brief. The mobile flow uses ADR 0008's eight.

### 02 Search results (2:179)

- **Covers:** URL as state (ADR 0004); filter chips plus an "All filters" drawer; sort separate from filters; result count; "Show more" with a cursor; states listed (skeleton, zero results, error with retry, end of list) (PRD-05).
- **Missing:** neighborhood as a filter (it is only in the search pill) (PRD-02); category and neighborhood pages with editorial copy (PRD-65); the extra filters the PRD names: age suitability, indoor or outdoor, group size, wheelchair access (PRD-06); a guide-only card variant (PRD-13).
- **Contradicted:** map with pins (PRD-08, ADR 0004); "4.5+ rating" filter (no ratings at launch, Q-09).
- **No PRD ID:** "Duration" and "Free cancellation" filters. Suggestions, not launch design.

### 03 Experience detail (3:2)

- **Covers:** gallery, title, rating line with neighborhood, duration, group cap, language; about; what's included; meeting point (as a map); reviews; cancellation policy; booking widget with date, time slots (sold out and "2 left"), guest stepper, itemized price, total, "Free cancellation until Fri, Oct 9" (PRD-09 in part, PRD-10, PRD-21 in part). Note says the widget becomes a bottom bar on mobile (PRD-11) but it is not drawn.
- **Missing:** the host (PRD-09); age rules (PRD-09, PRD-23); venue accessibility such as step-free access (PRD-09); outdoor label and weather policy (PRD-12); upcoming dates with spaces left as a list on the page rather than only inside a date field (PRD-09); a tax line on taxable experiences (PRD-19, PRD-78); "give as a gift" (PRD-33); a route for groups over the cap (PRD-35, Should); the guide-only version of the page (PRD-13).
- **Contradicted:** "Add to cart" (PRD section 5); "Service fee $12.00" (Q-03); "Save" (PRD-38, Later); 212 reviews (Q-09); map (ADR 0004).
- **Watch:** the guest stepper has no upper limit; one guest or device may hold at most 6 spaces (PRD-17). Kids' experiences need adults and children counted separately where pricing or capacity differ (PRD-23). The date is drawn as a text field; it needs the accessible date picker (ADR 0005).
- **Fine as is:** "Exact address is sent after booking" alongside the neighborhood. PRD-09 needs the meeting point; showing the area before booking and the exact address on confirmation (PRD-25) meets it and protects home studios.

### 04 Cart (3:133)

- **Conflict:** the whole frame. Launch is one session per checkout with no cart (PRD section 5, PRD-14).
- **Carries over:** the hold banner and timer (PRD-16) moves to checkout; the line item becomes the order summary in checkout.
- **Drop:** promo code (no PRD ID); "Continue browsing"; "You might also like" here (the module itself stays available on home).
- **Hold time:** v0 shows 14:52, implying 15 minutes. PRD-16 proposes 10.
- **States list:** "empty cart" drops with the cart. PRD section 11 leaves this for Dave at the P3 gate.

### 05 Checkout (3:253)

- **Covers:** one page, inline validation; guest checkout; express pay first; Pay button carries the total; idempotent, double-tap-safe submit (PRD-22); minimal header; hold timer in the summary (PRD-16); error states listed (decline, hold expired, sold out mid-checkout, network failure after submit) (PRD-20, PRD-21, PRD-22).
- **Missing:** newsletter opt-in, unticked, recorded (PRD-15, PRD-73); 21+ confirmation, child ages within range, and a guardian contact (PRD-23); the host's waiver text and its acceptance where required (PRD-24); a tax line (PRD-19, PRD-78); a restatement of the cancellation terms next to Pay (PRD-10); the gift fields: recipient name, email, message, delivery date (PRD-33).
- **Contradicted:** two experiences in one order (PRD-14); "Service fees" (Q-03); PayPal (PRD-18); "Back to cart" as the only exit (no cart; the exit is back to the experience); card number, expiry, CVC drawn as Ramble's own inputs. Card data never touches Ramble's servers (PRD-72), so the card block is the provider's embedded element (ADR 0003; the demo uses the fake gateway behind the same interface).
- **Watch:** "Have an account? Sign in for faster checkout" depends on PRD-37. Phone is drawn as a required field; PRD-15 asks only for email. Suggest phone stays optional, for day-of contact. "Dietary needs" and "Can every guest swim?" are host questions with no PRD ID; Suggestions.
- **Terms checkbox:** v0 bundles "cancellation policy and terms of service" into one box. PRD-24 needs Ramble's marketplace terms, plus the host's waiver as its own acceptance when the host requires one.

### 06 Confirmation (3:382)

- **Covers:** "You're booked", reference number, receipt email, date, time, party, area, add to calendar, directions, manage booking, cancellation deadline, a closing discovery module; refresh-safe by order id (PRD-25, PRD-26).
- **Missing:** the itemized total paid (PRD-25); the meeting point itself, not just the area (PRD-25); for outdoor sessions, when the weather call is made and how guests hear (PRD-27); a help link (PRD-54); the gift confirmation (PRD-33).
- **Contradicted:** two bookings (PRD-14); "Tickets are in your email and in your account" (PRD-37); "Your host messages you 24 hours before" (Ramble sends the reminder, PRD-27).

## The gaps named in the brief for this review

| Gap | PRD | In v0 | Where it lands in the mobile flow |
|---|---|---|---|
| Gift purchase | PRD-33 | Missing | 04 "Book for me / Give as a gift" switch; 05b gift checkout; 06b gift confirmation. Redemption: see decision 2 |
| Gift guide | PRD-04 | Missing | Home module (01) and a listing page (02 template), with a sponsor slot pending Q-13 |
| Guide-only pages | PRD-13 | Missing | Card variant in 02; page variant 03b with no booking bar and a clearly marked link out |
| Sticky booking bar | PRD-11 | Note only | 03, fixed to the bottom: price per person, next date, "Choose date" |
| Hold timer | PRD-16 | Cart and checkout, 15 min | 05 header, 10 min; expiry on the states page |
| Sold out | PRD-21 | Slot chip only | 04 slot states; "sold out before hold" and "sold out after lapse" on the states page |
| Age rules | PRD-23 | Missing | Badge on cards and 03; adult/child split in 04; 21+ confirm or child ages and guardian contact in 05; recipient confirms at redemption |
| Waivers | PRD-24 | Missing | 05, the host's waiver text with its own acceptance, only when the host requires it |
| Cancellation terms before checkout | PRD-10 | Bottom of page, line under widget | 03 key facts and its own section; repeated in 04 and next to Pay in 05 |
| Weather policy | PRD-12 | Missing | Outdoor badge on cards and 03; weather policy section in 03; weather call note in 06 |

## Out of v0's reach, and of P3 as written

- **Manage booking** (PRD-26 Must, PRD-30 Should): v0 has the button only.
- **Gift redemption** (PRD-33 Must): the recipient picks a date; v0 has nothing.
- **Private group request** (PRD-35 Should): a short form from 03.
- **Help pages** (PRD-54): content pages from the library; no frame needed.
- **Host and ops screens** (PRD-39 to PRD-57): BUILD-PLAN P3 covers the guest flow only. PRD-41 carries a usability target (a week of sessions in 5 minutes), which is a design question for the host side. Raised as decision 3.

## Proposed mobile screens, 390 wide

One listing template and one experience template carry most of the site; gifting rides the booking flow.

| # | Screen | Variants on the same page | PRD |
|---|---|---|---|
| 01 | **Home** | | 01, 03, 04, 77: header (wordmark, Gifts, menu), hero search (neighborhood, date, party, category), category rail, Ramble Picks module, gift guide module with sponsor slot, a "this week" module, trust strip, footer with Help, Terms, Privacy, Host with Ramble |
| 02 | **Browse** (one template for category, neighborhood, Ramble Picks, gift guide, and search results) | 02b filter drawer open | 02, 03, 04, 05, 06, 13, 65; ADR 0004: editorial intro where the page has one, chips (date, neighborhood, category, All filters), result count, single-column cards including a guide-only card, Show more. 02b: date, neighborhood, category, price, age, indoor or outdoor, group size, access, "Show N results" |
| 03 | **Experience** | 03b guide-only page | 09, 10, 11, 12, 23, 32, 33, 35: gallery, title, key facts (area, duration, price per person, age rule, outdoor and weather), about, included, host, meeting point as text with Open in Maps, accessibility, weather policy, cancellation terms, upcoming dates with spaces left, reviews slot (hidden under 5), "Booking for a group?" link, sticky booking bar. 03b: no bar, "Not bookable on Ramble yet", link out to the host |
| 04 | **Choose date and party** (bottom sheet from the booking bar; replaces the cart) | 04b kids' experience (adults and children); 04c 21+ | 14, 16, 17, 21, 23, 33: switch "Book for me / Give as a gift", calendar of open dates, time slots (open, few left, sold out, selected), party stepper capped at 6 and at spaces left, itemized total, cancellation terms line, Continue (places the hold) |
| 05 | **Checkout** | 05b gift checkout | 10, 15, 16, 18, 19, 20, 22, 23, 24, 72: minimal header with hold timer, collapsible order summary, email and unticked newsletter opt-in, optional phone, attendee rules (21+ confirm or child ages and guardian contact), host waiver where required, Ramble terms, Apple Pay and Google Pay, provider card block, total with tax line where taxable, "Pay $X". 05b: recipient name, email, message, delivery date; no attendee details |
| 06 | **Confirmation** | 06b gift scheduled | 25, 26, 27, 33, 54: booked headline, reference, email sent, booking card (date, time, meeting point, party, itemized total paid, cancellation terms), Add to calendar, Open in Maps, Manage booking, weather call note for outdoor sessions, help link, discovery module. 06b: who gets the gift, when, and what they receive |

**Components this implies for the library** (feeds step 3): Header, Footer, Button, Input, Checkbox, Chip (filter and time-slot states), Badge (Outdoor, 21+, Kids, Step-free), Card (bookable, guide-only, with and without rating), Booking bar, Booking sheet, Date picker, Stepper, Filter drawer, Hold timer, Order summary, Alert (inline error and notice), Section header.

**States page changes** (for later in P3): drop "empty cart" (with the cart); add "hold blocked" (PRD-17), "sold out before the hold is placed" (PRD-21), and "payment succeeded after the hold lapsed, refunded automatically" (ADR 0002 item 4).

## Decisions for Dave

> **Decided 2026-10-18 (Dave):** all four adopted as recommended.

1. **The six screens above, with variants (02b, 03b, 04b, 04c, 05b, 06b).** Recommended. The alternative is to keep v0's six names and squeeze the booking sheet into 03, which hides the screen with the most interaction on a phone.
2. **Manage booking and gift redemption as frames 07 and 08 in P3.** Recommended: both are Musts with their own UI (PRD-26, PRD-33), and the P4 estimate is better with them drawn. Alternative: design them in P5 from the library. Either way it is a change to P3's scope, so it is yours.
3. **Host and ops screens stay out of P3** and are built from the library in P5, with one PM note in the P4 design doc that PRD-41's 5-minute target needs a usability check on the built screen. Recommended, because P3's gate is the guest flow. Alternative: a host "publish a week" frame in P3.
4. **"Empty cart" leaves the states page** and the three states above join it (PRD section 11 asks you to settle this at the P3 gate; settling it now lets the states page be drawn once).

## Suggestions (no PRD ID; logged, not designed)

Recently viewed module; Duration and Free cancellation filters; promo codes; Share button on the experience page; host-defined booking questions such as dietary needs or "can every guest swim".
