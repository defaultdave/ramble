# 57hours teardown

Researched 2026-10-16. Basis labels: [documented] [reported] [inferred].

Read-only pass, no booking started. "Live page" means served on 2026-10-16 and read at 375px width. The traveler help center is login-gated and was not read.

## 1. Snapshot

- Marketplace linking travelers with independent local guides and small guiding companies. About 2,125 guides and 1,539 to 1,610 adventures (counts differ by page). [documented] ([guide page](https://guide.57hours.com/join), [account page](https://57hours.com/my-account/help-center/))
- Categories: hiking, biking, backcountry skiing, climbing, mountaineering, kayaking, sailing, surfing. Main markets: Alps, Dolomites, Iceland, Norway, US national parks, Patagonia, Japan. [documented] ([home](https://www.57hours.com))
- Destination travelers on multi-day trips (3 to 7 days in the sample, a few 2-day camps), not locals. [inferred]

## 2. Fees and business model

| Item | Finding | Basis |
|---|---|---|
| Role | Platform "not a party" to the traveler-guide contract. Payment "facilitated through a third-party payment processor." Merchant of record not stated. Checkout loads Stripe. 57hours issues refunds and pays guides, so it holds the money. Terms are from March 2024 (older than 12 months). | [documented](https://57hours.com/terms-of-use/), [inferred] |
| Traveler fee | "Booking fees" line: $56.25 on $1,250 (4.5%), $109.58 on $2,435 (4.5%), $29.70 on $495 (6.0%), one traveler. Why the rate varies is not verified. | [documented](https://57hours.com/product/mountaineering-presidential-traverse/) ([2](https://57hours.com/product/yosemite-national-park-camping-tour/), [3](https://57hours.com/product/intro-to-outdoor-climbing)), rates [inferred] |
| Price display | Detail page shows "From $1,250 (USD)", fee excluded. Flow step 1 shows $1,306.25, fee folded in, itemized behind a chevron. Not all-in on the detail page. Protection adds about 10% (Core) or 18% (Premium) of the fee-inclusive total. Credits of about 3% of that total go to a wallet after the trip begins. | [documented](https://57hours.com/adventure/traverse-mountaineering-nh/), percentages [inferred] |
| Guide commission | Guide page: "You keep 75% of every booking" (implies a 25% take). Whether the traveler booking fee sits inside or on top of that 25%: not verified. Press (Apr 2026): 20% to 30%, a writer's statement with no named source. Backpacker (published 2020-05-08, outdated): 10% commission and a 3.1% fee on all bookings, payer not stated. Superseded by the current figures. | [documented](https://guide.57hours.com/join), take [inferred]; [reported](https://thehustle.co/news/this-platform-connects-adventure-seekers-with-trusted-guides); [reported](https://www.backpacker.com/trips/how-57hours-is-making-hiring-a-guide-easier-than-ever/) |
| Guide payout | "Payouts are sent 30 days before each trip's departure date." Traveler balance is due 90 days out, so the platform holds a balance paid at the deadline about 60 days. Deposits are held longer, and bookings inside 90 days are paid in full at booking. Payout amount and timing for late bookings: not verified. | [documented], gap [inferred] |

## 3. Booking flow on a phone

| Step | What happens | Source |
|---|---|---|
| Detail page | Hero: "From $X", red "Reserve now", "Send inquiry", "Book a call". | live page |
| Sticky bar | After scrolling, a fixed bottom bar (price plus "Reserve now") and a fixed top menu (Intro, Itinerary, FAQ, Go Private) appear. | live page |
| Availability | Date cards: "Available", "Only N spots left", "Sold out" with "Join waitlist". | live page, [listing](https://57hours.com/premium-adventures/sailing-and-skiing-lyngen-alps/) |
| Date and party | Step 1: calendar field and traveler stepper, earliest date and 1 traveler preselected, choices kept in the URL. Optional note to guide. | live page |
| Order summary | Total, "Cancel in the first 48h for free", insurance note. Not sticky. | live page |
| Protection | Standard / Core / Premium cards with refund rules and a coverage modal, so the policy shows before payment. Also in a collapsed "Deposit and cancellation policy" section on the detail page. | live page |
| Payment | "Reserve" (30% deposit) or "Pay in full". Example: $375 deposit plus $56.25 fee reads "Pay $431.25 now". Full payment inside 90 days of departure. Deposit is 50% on one camp. | live page, [listing](https://57hours.com/product/intro-to-outdoor-climbing) |
| Account | Email code, Google, Apple. Account auto-created. No guest checkout found. Trigger step not verified (needs a live checkout). | live page |
| Wallets | Stripe loaded. Wallets and pay-later providers not verified (needs a live checkout). | live page source |
| Confirmation | Terms: 57hours confirms, then assigns a guide, and the contract binds on that email. Permit trips: dates "tentative until permitted 22 weeks in advance." Instant vs request wording not verified (needs a live checkout). | [documented](https://57hours.com/terms-of-use/), live page |
| Hold or timer | None found in page source. | live page |
| Third party | Review (Mar 2022, older than 12 months): "as easy as booking an Airbnb," guide assigned after booking. | [reported](https://huckadventures.com/backcountry-skiing-with-57hours-guided-adventures/) |

## 4. Cancellation and refunds

Refunds are a percent of trip price. On Standard terms, booking fees are non-refundable after a 48 hour grace period. The Core and Premium refund tooltips say their percentages include booking fees and that insurance is not refunded, while the policy bullets under every tier card repeat the Standard fee line (page conflict). [documented, live page]

| Listing (Standard terms) | 48h | Stepped refund | Then |
|---|---|---|---|
| [Presidential Traverse](https://57hours.com/adventure/traverse-mountaineering-nh/) | 100% | 70% at 60+ days | 0% |
| [Myoko ski](https://57hours.com/adventure/myoko-ski-holidays/) | 100% | 70% at 60+ days | 0% |
| [Lyngen sail-ski](https://57hours.com/premium-adventures/sailing-and-skiing-lyngen-alps/) | 100% | 70% at 90+, 50% at 45 to 89 days | 0% |
| [Plitvice (kayaking)](https://57hours.com/premium-adventures/multisport-tour-plitvice-hidden-croatia/) | 100% | 70% at 90+ days | 0% |
| [Yosemite camping](https://57hours.com/product/yosemite-national-park-camping-tour/) | 100% | 70% at 90+ days | 0% |
| [Intro climbing camp](https://57hours.com/product/intro-to-outdoor-climbing) | 100% | 50% at 120+ days | 0% |

- **Lyngen source conflict:** the page's hidden structured-data FAQ lists an older schedule (35% non-refundable deposit; 70% at 120+ days, 50% at 90 to 119, 25% at 60 to 89, 0% under 60). The visible policy (30% deposit, table above) is used here. [documented], which copy is current [inferred]
- **Host-selectable:** guides select the policy with their account manager. Whether it is a fixed menu is not stated. [documented](https://guide.57hours.com/join)
- **Protection tiers:** Core refunds 75% for a covered reason (illness, death, disaster, travel advisory). Premium refunds 100% for a covered reason and 75% for any reason up to departure, and is the only tier that covers changing your mind. Percentages are of the full trip price, not of what was paid at booking. On the Presidential Traverse page the coverage table shows Premium at 75% at 60+ days while the card bullets say 70%. [documented, live page]
- **Weather:** guide may modify or cancel for unsafe conditions "in the Guide's sole discretion," then 57hours offers an alternative date or "an appropriate refund." After the trip starts, no refunds for weather or early finish. [documented](https://57hours.com/terms-of-use/)
- **Minimum group:** listings state 3 to 4 people (Yosemite 3, Myoko and Plitvice 4; Lyngen states none). Current pages do not say what happens if missed. An older search-indexed copy reportedly let the guide cancel up to two months out (not verified: the older copy could not be opened). [reported]
- **No-shows, rescheduling:** the terms give no credits or refunds if a traveler decides "for any reason not to begin or continue." The words no-show and rescheduling do not appear, and no rescheduling fee is stated. [documented](https://57hours.com/terms-of-use/)
- **Host cancellation:** the terms cover weather only (alternative date or "an appropriate refund," no amounts). 57hours also reserves the right to cancel Listings or Bookings at its sole discretion, with no refund stated. Other host cancellations are not addressed. [documented](https://57hours.com/terms-of-use/)

## 5. Takeaways

- Headline price is pre-fee. A 4.5% to 6% traveler fee first shows in the flow total.
- Cancellation is a priced tier: Core and Premium are insurer-backed upsells shown before payment.
- Stepped refunds with a cliff 45 to 120 days out are the norm, alongside 30% to 50% deposits and 90-day balances.
- Dates depend on permits, minimums, and guides, so "Send inquiry" and "Book a call" sit beside "Reserve now".
- Guide take is a 25% implied by the guide page now [inferred]. Press (Apr 2026) says 20% to 30%. The 10% figure from 2020 is outdated. Guides are paid 30 days before departure.

## Comparable: TourRadar

Multi-day guided tour marketplace where the operator sets cancellation terms, including whether the deposit is refundable, linked during booking ([traveler help](https://support.tourradar.com/en/customers/is-my-deposit-refundable)). The traveler page says deposits are typically non-refundable. TourRadar applies a commission fee on traveler cancellations and charges a platform service fee on operator-cancelled bookings, both "in line with the Operator Contract" ([operator help](https://help.tourradar.com/en/operators/does-tourradar-charge-a-cancellation-fee)). Commission rate, fee amounts, and merchant-of-record status are not stated there. [documented] Traveler help last updated 2026-08-17. Operator help is undated.

## 6. Sources

All accessed 2026-10-16.

- https://www.57hours.com
- https://57hours.com/my-account/help-center/ (login page only)
- https://57hours.com/terms-of-use/ (updated March 2024, older than 12 months)
- https://guide.57hours.com/join (via https://57hours.com/get-listed/)
- https://57hours.com/adventure/traverse-mountaineering-nh/
- https://57hours.com/adventure/myoko-ski-holidays/
- https://57hours.com/premium-adventures/sailing-and-skiing-lyngen-alps/
- https://57hours.com/premium-adventures/multisport-tour-plitvice-hidden-croatia/
- https://57hours.com/product/mountaineering-presidential-traverse/
- https://57hours.com/product/yosemite-national-park-camping-tour/
- https://57hours.com/product/intro-to-outdoor-climbing
- https://thehustle.co/news/this-platform-connects-adventure-seekers-with-trusted-guides (2026-04-22)
- https://www.backpacker.com/trips/how-57hours-is-making-hiring-a-guide-easier-than-ever/ (2020-05-08, older than 12 months)
- https://57hours.com/frequently-asked-questions/ (published 2019-04-23, modified 2021-12-09, older than 12 months; used only in Verification)
- https://huckadventures.com/backcountry-skiing-with-57hours-guided-adventures/ (March 2022, older than 12 months)
- https://support.tourradar.com/en/customers/is-my-deposit-refundable
- https://help.tourradar.com/en/operators/does-tourradar-charge-a-cancellation-fee
- Search-indexed older copies of 57hours listing pages (WebSearch, 2026-10-16), used only for the older minimum-group wording

## Verification

Dated 2026-10-16. Fee and cancellation claims re-checked against current primary pages, opened fresh rather than trusting the cited links. Live pages were read at their default state (no picker used, no step advanced). Terms, listing, and help pages were read in full text. Booking-flow claims were not checked.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Fee $56.25 on $1,250 (4.5%), flow total $1,306.25, detail page "From $1,250" | Confirmed | [Flow page](https://57hours.com/product/mountaineering-presidential-traverse/) shows subtotal $1,250.00, booking fees $56.25, total $1,306.25 (Dec 1 to 3, 2026, 1 traveler). [Detail page](https://57hours.com/adventure/traverse-mountaineering-nh/) header reads "From $1,250 ( USD )" and does not say fees are included. 56.25 / 1,250 = 4.50%. |
| 2 | 4.5% Yosemite, 6.0% climbing camp | Confirmed | [Yosemite](https://57hours.com/product/yosemite-national-park-camping-tour/): $109.58 on $2,435.00, total $2,544.58 (4.50%). [Climbing](https://57hours.com/product/intro-to-outdoor-climbing): $29.70 on $495.00, total $524.70 (6.00%). Why the rate differs: unverifiable, no page explains it. |
| 3 | Guide FAQ: keep 75%, no upfront or listing fees | Confirmed. Inside or on top of the 25%: unverifiable | [Guide page](https://guide.57hours.com/join) FAQ "How does the commission work?" says you keep 75% of every booking, with no upfront costs or listing fees. An older company [FAQ](https://57hours.com/frequently-asked-questions/) (modified 2021-12-09, older than 12 months) says the booking fee does not cut into guides' earnings. Too old to settle the question for the 25%. |
| 4 | Press: 20% to 30% commission | Confirmed | [The Hustle](https://thehustle.co/news/this-platform-connects-adventure-seekers-with-trusted-guides), published 2026-04-22 (page metadata). The sentence is the writer's, with no named source. 25% sits inside the range. |
| 5 | Backpacker: 10% from guides, 3.1% fee | Outdated | [Backpacker](https://www.backpacker.com/trips/how-57hours-is-making-hiring-a-guide-easier-than-ever/) metadata: published 2020-05-08 (the visible "Updated December 4, 2024" does not change the date in the metadata). The text says 57hours "only takes 10 percent" and charges a 3.1 percent fee on all bookings. It does not say who pays the fee. Current figures differ: guide keeps 75%, observed booking fees are 4.5% and 6.0%. |
| 6 | Payout 30 days before departure; balance due 90 days; ~60-day hold | Confirmed, with limits | Guide FAQ "When do I get paid?" matches the quoted sentence. Listing pages state 30% deposit and 70% due 90 days out; the Yosemite flow shows the balance due Feb 13, 2027 for a May 14, 2027 departure (90 days). The 60-day gap is arithmetic and holds only for a balance paid at the deadline. Deposits are held longer, late bookings pay in full at booking, and the payout amount is not stated. Body text edited. |
| 7 | Core ~10%, Premium ~18%, credits ~3% | Confirmed | Presidential Traverse flow: Core +$130.63 (10.0% of $1,306.25), Premium +$235.13 (18.0%), credits $39.19 (3.0%, "added to your wallet after your trip begins"). Yosemite and climbing flows give the same 10%, 18%, 3% of their fee-inclusive totals. Detail page shows "Earn $37.50 or more" (3.0% of $1,250). Body text now says the percentages are of the fee-inclusive total. |
| 8 | Standard policy on Presidential Traverse and Myoko | Confirmed | Both listing pages: full refund within 48 hours, 70% of total trip price at 60+ days, none within 59 days, booking fees non-refundable after the 48-hour grace period. [Myoko](https://57hours.com/adventure/myoko-ski-holidays/) |
| 9 | Thresholds by listing | Confirmed, with one source conflict | [Lyngen](https://57hours.com/premium-adventures/sailing-and-skiing-lyngen-alps/) visible policy: 70% at 90+, 50% at 45 to 89, none within 44. [Plitvice](https://57hours.com/premium-adventures/multisport-tour-plitvice-hidden-croatia/) (now redirects to /adventure/multisport-tour-plitvice-hidden-croatia/): 70% at 90+, none within 89. Yosemite: 70% at 90+, none within 89. Climbing: 50% at 120+, none within 119, deposit 50% ($277.20 now incl. fee, $247.50 remaining). Conflict: the Lyngen page also carries a hidden structured-data FAQ with an older schedule (see Section 4). |
| 10 | Protection tier refunds and the 75% / 70% inconsistency | Confirmed, refined | Coverage modal: Core 75% for a covered reason, Premium 100% covered and 75% any reason, percentages "of the full trip price, not of what you've paid at the time of booking," and Premium is the only plan covering a change of mind. Presidential Traverse modal table shows Premium 75% at 60+ days while the card bullets say 70%. Added: tooltips say these percentages include booking fees, and insurance is not refunded. |
| 11 | Booking fees non-refundable after 48 hours; 48-hour refund includes fees | Corrected | Standard tooltip: "70% of the trip price. Booking fees are non-refundable." The 48-hour sentence is confirmed: full refund on all plans, "including booking fees and insurance." Correction: Core and Premium refund tooltips say their percentages include booking fees, yet the bullets under each tier card still repeat the non-refundable fee line. The fee rule holds for Standard only. Body text edited. |
| 12 | Terms: cancellation, weather, in-trip, March 2024 | Confirmed, one correction | [Terms](https://57hours.com/terms-of-use/) "Last Updated: March 2024." All quoted phrases match. Correction: the terms do address a traveler who decides not to begin or continue a trip (no credits or refunds), so "no-show not addressed" was too broad. The words no-show and rescheduling are absent. They also list a "Client Fee" and a "Guide tip" among the fees shown before booking. Mapping "Client Fee" to the "Booking fees" line is inferred. Body text edited. |
| 13 | Cancellation policy is guide-selectable | Confirmed | Guide FAQ "How do I set my dates and prices?" says the account manager works with the guide on adding departure dates, setting prices, and selecting the cancellation policy that best fits the trips. Whether the policy comes from a fixed menu is not stated. |
| 14 | Minimum-group cancellation | Unverifiable | Minimums confirmed on current pages: Yosemite 3, Myoko 4, Plitvice 4. Lyngen states none. No current page says what happens if a minimum is missed. The older "two months" wording appeared only in a search-engine summary of an indexed copy. The copy itself could not be opened. Marked "not verified" in Section 4. |
| Extra | Section 3 payment example ($375 deposit + $56.25 fee = "Pay $431.25 now") | Confirmed | Flow shows "Pay $431.25 now" with $875.00 remaining. |
| Extra | TourRadar fee and cancellation statements | Corrected | Operator help says a "commission fee on cancellation(s)" applies, not a commission on cancellation fees. Customer help shows "Last updated: August 17, 2026" (the file said no date). Operator help is undated. [Customer help](https://support.tourradar.com/en/customers/is-my-deposit-refundable) (now at /faq/is-my-deposit-refundable) |

**What changed in the body**
- Guide commission row: Backpacker marked outdated and its fee payer marked not stated. Booking-fee inside or outside the 25% marked not verified.
- Guide payout row: 60-day hold limited to a balance paid at the deadline.
- Price display row: protection and credit percentages tied to the fee-inclusive total.
- Section 4: booking-fee rule limited to Standard terms, Lyngen schedule conflict added, tier percentages clarified, no-show and host-cancellation lines rewritten to match the terms, minimum-group line carries "not verified".
- Takeaway on commission and TourRadar paragraph corrected.

**Still unverified**
- Why the booking-fee rate is 4.5% on two listings and 6.0% on one.
- Whether the traveler booking fee sits inside or on top of the guide-facing 25% take.
- The payout amount at 30 days, and payout timing for bookings made inside 90 days.
- What happens when a listing's minimum group is not met.
- Whether the 20% to 30% press figure has a named source.
- The traveler help center (login-gated) was not read, so no traveler-facing fee explainer was checked.
