# Airbnb Experiences teardown

Researched 2026-10-16. Basis labels: [documented] [reported] [inferred].

Flags: help articles are undated. The relaunch post, the Arival piece and the Refund Policy (effective 13 May 2025) are over 12 months old. Fee and cancellation claims were fact-checked on 2026-10-16 (see Verification).

## 1. Snapshot

- Host-led tours, classes, tastings and outdoor trips, bookable in the Airbnb app and site next to homes and Services. Relaunched 13 May 2025 in 650 cities across five category groups (landmarks, food, outdoors, art workshops, wellness) plus celebrity-hosted "Originals" ([newsroom](https://news.airbnb.com/airbnb-2025-summer-release)) [documented, over 12 months old].
- Pitched at travelers (the app suggests experiences near a stay), but listings show on the public homepage without sign-in ([newsroom](https://news.airbnb.com/airbnb-2025-summer-release), [homepage](https://www.airbnb.com/experiences)) [documented]. Locals can book them [inferred].
- Scale: about 3,000 experiences in about 100 cities, focus since narrowed to Paris ([Skift, Aug 2026](https://skift.com/2026/08/11/airbnb-partners-with-tripadvisor-experiences-drops-build-your-own-strategy/)) [reported]. Q2 2026 supply up nearly 80% year over year ([8-K](https://www.sec.gov/Archives/edgar/data/0001559720/000119312526337928/d70413dex991.htm)) [documented]. Tripadvisor Group tours become bookable on Airbnb "later this year"; terms undisclosed ([press release](https://tripadvisor.mediaroom.com/2026-08-11-Tripadvisor-Group-and-Airbnb-Announce-Experiences-Partnership)) [documented].

## 2. Fees and business model

| Point | Finding | Basis |
|---|---|---|
| Seller of record | The host contracts with the guest; Airbnb "is not a party" to that contract ([ToS, 5 Feb 2026](https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf)) | [documented] |
| Payments | Airbnb Payments is the host's limited payment collection agent; paying it settles the guest's debt to the host ([Payments Terms](https://www.airbnb.com/terms/payments_terms)). An agent model, not resale | [documented], [inferred] |
| Host commission | Typically 20% of the host's price, deducted from payout ([help 3164](https://www.airbnb.com/help/article/3164), [help 1857](https://www.airbnb.com/help/article/1857)). Services are 15%, $6 minimum | [documented] |
| Promo rate | Arival reported "some operators are getting a special rate of 10% through June" (article dated 13 May 2025, so June 2025 [inferred]). Arival's own reporting, not an Airbnb statement. No later source found on whether it ended or was extended ([Arival](https://arival.travel/article/inside-airbnb-experiences-relaunch/)) | [reported], over 12 months old |
| Guest fee | Help says guests "are shown the total price" and "No other service fees are charged to guests at this time" ([help 1604](https://www.airbnb.com/help/article/1604), undated). The Pre-Booking Offer Terms (discounts and coupons), last updated 25 Sep 2026, name "the guest service fee" among charges a guest still owes after an offer, without saying it applies to Experiences ([terms](https://www.airbnb.com/help/article/4165)). The ToS says applicable fees are disclosed to guests before booking and sets no guest rate ([ToS](https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf), section 10). A guest fee on Experiences is not established either way | [documented]; not verified (needs a live checkout) |
| Price display | The main listing shows "From $69 / guest" ([detail page](https://www.airbnb.com/experiences/4218000)). Struck-through prices ($69 to $56, $48 to $44, label "previously, $69") appear on related-experience cards at the bottom of that page, not on the main listing's price. Cards on the [experiences page](https://www.airbnb.com/experiences) showed one price each when read. The same tour showed $56, $64 and $79 across sections, so "From" is not a fixed price (cause not verified). Taxes and checkout total: not verified (needs a live checkout) | [documented] |
| Payout timing | Payments Terms 3.3.1: for Services and Experiences, by the end of the business day after the start, conditional on receiving the guest's payment; arrival depends on the payout method (3.3.2) ([Payments Terms, updated 5 Feb 2026](https://www.airbnb.com/terms/payments_terms)). Experiences help: "The day after you host an experience, Airbnb will release your payout"; arrival depends on the financial institution, weekends and bank holidays ([help 1569](https://www.airbnb.com/help/article/1569/how-do-payouts-for-experiences-work), [topic 1536](https://www.airbnb.com/help/topic/1536)). [Help 2858](https://www.airbnb.com/help/article/2858) is an archived copy of the Payments Terms (26 Jun 2025) | [documented] |

## 3. Booking flow on a phone

Source key: LIVE = public page read at 375px width (listing [4218000](https://www.airbnb.com/experiences/4218000)) or by fetch; HELP = Airbnb help center; 3P = third party.

| Point | Finding | Source |
|---|---|---|
| Discovery | Experiences tab; search by city and dates; "Nearby" ([help 1584](https://www.airbnb.com/help/article/1584)). Homepage rows show "Experiences this weekend" with start times ([homepage](https://www.airbnb.com/experiences)) | HELP, LIVE |
| Detail page order | Photo, title, rating, chips ("Free cancellation", "Private groups welcome"), host, what you'll do, reviews, "Upcoming availability", map, Things to know | LIVE |
| Availability | A dated list of sessions with time ranges (five Saturdays, 11:30 AM to 1:30 PM), five shown then "Show all". Spot counts not seen. Hosts can set booking cutoffs ([help 1934](https://www.airbnb.com/help/article/1934)) | LIVE, HELP |
| Sticky bar | Floating rounded bar at the bottom on load: "From $69 / guest" plus a "Show dates" button. Scroll behavior not verified | LIVE |
| Date, time, party | "Show dates" opens the picker; not opened here. A reservation covers up to 10 guests, more invited by link until one day before ([help 3150](https://www.airbnb.com/help/article/3150)). "Book for a private group" is host-optional ([help 2594](https://airbnb.com/help/article/2594/how-do-i-book-an-experience-for-a-private-group)) | HELP |
| Instant vs request | Standard listings: not documented; not verified (needs a live checkout). Originals use request-to-book with random selection and 24 hours to complete after invitation ([help 3407](https://www.airbnb.com/help/article/3407)). Custom dates are requested by message and the host decides ([help 2644](https://airbnb.com/help/article/2644/how-do-i-request-to-book-a-new-date-or-time-for-an-experience)) | HELP |
| Account | ToS: "You must register an account to access and use many features" ([ToS](https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf)). Guest checkout: not verified | HELP (ToS) |
| Payment methods | Cards, Apple Pay, Google Pay, PayPal, Klarna (US and Canada) ([help 1014](https://www.airbnb.com/help/article/1014)); article does not name experiences. Reserve Now, Pay Later "may be available depending on the listing" ([Payments Terms](https://www.airbnb.com/terms/payments_terms)). Experiences: not verified | HELP |
| Hold or timer | None documented. Not verified (needs a live checkout) | none |
| Cancellation before paying | "Free cancellation" chip, "Up to 1 day before start time" in the bar, and full text under Things to know: "Cancel at least 1 day before the start time for a full refund" ([detail page](https://www.airbnb.com/experiences/4218000)); also in the booking flow ([help 1593](https://www.airbnb.com/help/article/1593)) | LIVE, HELP |
| Inventory feeds | Integrates with about a dozen booking systems (FareHarbor, Bokun, Peek, Ventrata) ([Arival](https://arival.travel/article/inside-airbnb-experiences-relaunch/)) | 3P |

## 4. Cancellation and refunds

| Case | Rule | Basis |
|---|---|---|
| Default | 1-day policy for most listings: full refund until 24 hours before start, local time; none after unless an exception applies or the host chooses to refund ([help 1565](https://www.airbnb.com/help/article/1565), [help 1593](https://www.airbnb.com/help/article/1593)) | [documented] |
| Tiers | Some hosts can choose a 3-day (72 hour) policy, depending on the offering; no other tier documented ([help 3874](https://www.airbnb.com/help/article/3874)) | [documented] |
| Exception | Guest cancels, then asks ([help 2279](https://www.airbnb.com/help/article/2279)). Host has 24 hours to accept or decline; accepting means a full refund, with no host consequence ([help 2836](https://www.airbnb.com/help/article/2836)). Not guaranteed | [documented] |
| Weather | Guest: poor weather alone earns no refund outside the free window unless it prevents the activity ([help 1593](https://www.airbnb.com/help/article/1593)). Host: weather that prevents an outdoor session is a valid reason to cancel; Airbnb decides on a fee waiver after reviewing the host's evidence ([help 2039](https://www.airbnb.com/help/article/2039)) | [documented] |
| Minimum group | Not documented in the pages read (help 1565, 1593, 2972, 2278, 2039); not verified | none |
| Guest no-show | Not addressed in help 1565, 1593, 2972 or 2278; likely treated as outside the window | [inferred] |
| Host cancels | Guest refunded automatically in full unless the guest caused the disruption ([policy](https://www.airbnb.com/help/article/2278)). Host may be charged 20% of booking value (base rate, excluding taxes and fees), normally withheld from payouts. Even if the fee is waived, the host gets no payout for the booking and the calendar may be blocked. Repeat or unexcused cancellations can lead to removal. Waivers for valid reasons (illness, unsafe venue, outdoor weather, Major Disruptive Events) are decided by Airbnb after it reviews the host's evidence ([help 2039](https://www.airbnb.com/help/article/2039)) | [documented] |
| Covered issues | Host over 15 minutes late, no-show, off-description, unprepared, or damaging a guest-provided venue: full or partial refund, by severity. The booking guest must report within 72 hours (later only if sooner was not feasible) and should first try the host when feasible. Overrides the listing policy ([policy](https://www.airbnb.com/help/article/2278)) | [documented] |
| Major disruption | Large-scale event at the listing location that prevents or legally prohibits the booking: full refund regardless of the listing policy; the host gets no payout ([help 1565](https://www.airbnb.com/help/article/1565)) | [documented] |
| Refund timing | Within 10 business days; the guest can review the refund amount before finalizing the cancellation ([help 2972](https://www.airbnb.com/help/article/2972)) | [documented] |
| Rescheduling | Inside the free window: any open slot on the host's calendar, price may change and is shown before confirming; no host step is described. Outside: request to host, who accepts or declines; if declined, no refund unless an exception applies or the host agrees to one ([help 1566](https://www.airbnb.com/help/article/1566)) | [documented] |

Airbnb tests policy variants, so reservation details govern ([help 2972](https://www.airbnb.com/help/article/2972)) [documented].

## 5. Takeaways

- Airbnb is a payment agent, not the seller: the host sets the price, Airbnb typically takes 20% from the host, and the guest sees one "From $X / guest" figure. Airbnb's pages do not settle whether a guest fee exists: help says none, and the offer terms name "the guest service fee" without tying it to Experiences.
- Cancellation terms show three times before payment (chip, bar, Things to know). The menu is short: 24 hours by default, 72 hours for some.
- The listing page centers on a dated session list and one persistent call to action that opens a date picker.
- Refunds work in layers: a listing policy, then overrides (host fault, major disruption). Hosts carry the penalty (possible 20% fee, calendar blocks, no payout).
- The product keeps shifting: host-led relaunch (May 2025), a Paris focus, then Tripadvisor inventory (announced Aug 2026) on unknown terms. This flow may not apply to partner inventory.

## 6. Sources

All accessed 2026-10-16.

- https://news.airbnb.com/airbnb-2025-summer-release
- https://www.airbnb.com/experiences
- https://www.airbnb.com/experiences/4218000
- https://www.airbnb.com/experiences/690043
- https://www.airbnb.com/help/article/3164
- https://www.airbnb.com/help/article/1604
- https://www.airbnb.com/help/article/1857
- https://www.airbnb.com/help/article/4165
- https://www.airbnb.com/help/article/2858
- https://www.airbnb.com/help/topic/1536
- https://www.airbnb.com/help/article/1584
- https://www.airbnb.com/help/article/3150
- https://airbnb.com/help/article/2594/how-do-i-book-an-experience-for-a-private-group
- https://www.airbnb.com/help/article/3407
- https://airbnb.com/help/article/2644/how-do-i-request-to-book-a-new-date-or-time-for-an-experience
- https://www.airbnb.com/help/article/1014
- https://www.airbnb.com/help/article/1565
- https://www.airbnb.com/help/article/1593
- https://www.airbnb.com/help/article/2972
- https://www.airbnb.com/help/article/3874
- https://www.airbnb.com/help/article/2836
- https://www.airbnb.com/help/article/2039
- https://www.airbnb.com/help/article/2278
- https://www.airbnb.com/help/article/1566
- https://www.airbnb.com/help/article/2279
- https://www.airbnb.com/help/article/1569/how-do-payouts-for-experiences-work
- https://www.airbnb.com/help/article/1934
- https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf
- https://www.airbnb.com/terms/payments_terms
- https://www.sec.gov/Archives/edgar/data/0001559720/000119312526337928/d70413dex991.htm
- https://tripadvisor.mediaroom.com/2026-08-11-Tripadvisor-Group-and-Airbnb-Announce-Experiences-Partnership
- https://skift.com/2026/08/11/airbnb-partners-with-tripadvisor-experiences-drops-build-your-own-strategy/
- https://arival.travel/article/inside-airbnb-experiences-relaunch/

## Verification

Dated 2026-10-16. Scope: fee, commission, price-display, cancellation and refund statements only. Booking-flow claims were not checked. Each primary source was opened again; no newer version of any cited page was found (the Refund Policy still reads "Effective date: May 13, 2025"; the ToS and Payments Terms still read "Last Updated: February 5, 2026").

**Confirmed (no change to the finding)**

| Claim | Source checked |
|---|---|
| Hosts pay a typical 20% on the host-set price, deducted from payout; Services 15%, $6 minimum | [help 3164](https://www.airbnb.com/help/article/3164), [1857](https://www.airbnb.com/help/article/1857), [1604](https://www.airbnb.com/help/article/1604) |
| 1-day default; some hosts get a 3-day option; no other tier documented | [help 1565](https://www.airbnb.com/help/article/1565), [1593](https://www.airbnb.com/help/article/1593), [3874](https://www.airbnb.com/help/article/3874), [2972](https://www.airbnb.com/help/article/2972) |
| Host cancel gives the guest an automatic full refund unless the guest caused it; policy effective 13 May 2025 for later reservations | [help 2278](https://www.airbnb.com/help/article/2278) |
| 20% host cancellation fee on booking value excluding taxes and fees; calendar blocks; possible removal | [help 2039](https://www.airbnb.com/help/article/2039) |
| Refunds within 10 business days; guest reviews the amount before finalizing | [help 2972](https://www.airbnb.com/help/article/2972) |
| Covered Issues overrule the listing policy; 72-hour report window | [help 2278](https://www.airbnb.com/help/article/2278) |
| Major Disruptive Event gives a full refund regardless of listing policy | [help 1565](https://www.airbnb.com/help/article/1565) |
| Guest weather rule; reschedule rules | [help 1593](https://www.airbnb.com/help/article/1593), [1566](https://www.airbnb.com/help/article/1566) |
| Host contracts with the guest; Airbnb "is not a party"; Airbnb Payments is a limited collection agent and guest payment extinguishes the guest's obligation | [ToS](https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf) sections 4.2 and 15, [Payments Terms](https://www.airbnb.com/terms/payments_terms) sections 4, 4.2 and 4.3 |
| Airbnb "sometimes" tests new cancellation policies | [help 2972](https://www.airbnb.com/help/article/2972) |
| Detail page shows "Free cancellation", "Up to 1 day before start time" in the bottom bar, and the full refund text under Things to know (read in the rendered page at 375px) | [detail page](https://www.airbnb.com/experiences/4218000) |
| Arival: 20% called "competitively low"; "special rate of 10% through June" (byline 13 May 2025) | [Arival](https://arival.travel/article/inside-airbnb-experiences-relaunch/) |

**Changed**

| Item | Change | Source |
|---|---|---|
| Guest fee conflict | Softened. The offer terms name "the guest service fee" generically and do not say it applies to Experiences, so a conflict with help 1604 is not established | [terms](https://www.airbnb.com/help/article/4165) |
| Payout timing citation | Help 2858 is an archived Payments Terms (26 Jun 2025). Re-cited to the current terms (same wording, updated 5 Feb 2026) and the experiences payout article | [Payments Terms](https://www.airbnb.com/terms/payments_terms), [help 1569](https://www.airbnb.com/help/article/1569/how-do-payouts-for-experiences-work) |
| Struck-through prices | They appear on related-experience cards, not on the main listing's price. The same tour showed $56, $64 and $79 across sections | [detail page](https://www.airbnb.com/experiences/4218000), [experiences page](https://www.airbnb.com/experiences) |
| Host cancellation fee waiver | Was stated as automatic. Airbnb decides after reviewing the host's evidence; no payout even when waived; "may charge", not always | [help 2039](https://www.airbnb.com/help/article/2039) |
| Exception request | Host "has 24 hours to decide", not to grant. Guest side added | [help 2836](https://www.airbnb.com/help/article/2836), [2279](https://www.airbnb.com/help/article/2279) |
| Covered Issues | Added damage to a guest-provided venue, severity-based amount, and the booking-guest and try-the-host-first rules | [help 2278](https://www.airbnb.com/help/article/2278) |
| Promo rate | Marked as Arival's own report, not an Airbnb statement; "June 2025" is inferred from the article date | [Arival](https://arival.travel/article/inside-airbnb-experiences-relaunch/) |
| Takeaways | "Pages disagree" on the guest fee replaced with "do not settle"; host penalties worded as possible | as above |

**Still not verified**

- Whether guests pay any fee or tax on Experiences at checkout (needs a live checkout).
- Why the "From" price for the same tour differs across sections and pages.
- Minimum-group cancellation rules (not in help 1565, 1593, 2972, 2278 or 2039; a search found nothing).
- Guest no-show treatment (not addressed in the same articles; the file's reading is inferred).
- Whether the 10% operator rate ended or was extended.
- Whether the 20% host rate applies to every host ("typically" in the help text).
- Help article dates: none of the cited help articles carries a date, so currency rests on the page footer (2026) and the dated terms above.
