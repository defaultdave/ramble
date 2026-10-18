# Market scan: bookable experiences

Prepared 2026-10-16 for Ramble P1. Market context for the PRD; client facts come from the client brief (discovery was skipped on 2026-10-18).

Scope: booking-flow patterns, fees and cancellation norms across seven marketplaces and one comparable. Basis labels: [documented] company's own pages or filings; [reported] third-party press or reviews; [inferred] our reasoning. [>12 mo] marks a source older than 12 months. NV means "not verified (needs a live checkout)"; n/c means not covered. Summary claims are sourced below.

## Summary

- **Role.** Airbnb and GetYourGuide act as the operator's payment agent. ClassBento, Cozymeal and 57hours say the contract is between guest and operator or that they are not a party to it. Viator is merchant of record ([10-K](https://www.sec.gov/Archives/edgar/data/1526520/000119312526051281/trip-20251231.htm)). CourseHorse does not say. [documented]
- **Who pays.** Operators. Published rates are 20% (Airbnb, [ClassBento](https://classbento.co.uk/teach)) and an implied 25% (57hours); the rest publish none.
- **Guest fees are the exception:** 57hours adds 4.5% to 6.0% in the flow ([example](https://57hours.com/product/mountaineering-presidential-traverse/)); Cozymeal shows $4.99 on 4 of 17 listings; Airbnb's pages do not settle it. Paid cancellation add-ons are appearing at GetYourGuide, Viator and 57hours.
- **Default cancellation** is 24 hours before start for short experiences (Airbnb, GetYourGuide, Viator) and 48 on Cozymeal. Providers set it on class marketplaces. Multi-day trips use stepped refunds with a cliff 45 to 120 days out.
- **Phone flow:** a dated session list or picker, a sticky bottom bar with price and one button, cancellation terms before payment. Live samples were small (one listing each on Airbnb and GetYourGuide, up to 22 elsewhere). No timers or holds were found.
- **Confidence is moderate:** no live checkout, Viator's traveler pages blocked, many old or undated help pages.

## Landscape

| Competitor | Categories | Audience | Merchant of record or agent | Guest fee | Operator commission | Default cancellation | Instant or request | Guest checkout allowed |
|---|---|---|---|---|---|---|---|---|
| Airbnb Experiences | Tours, classes, tastings, outdoor ([news](https://news.airbnb.com/airbnb-2025-summer-release), >12 mo) | Travelers; locals can book [inferred] | Host sells; Airbnb Payments is the host's collection agent ([terms](https://www.airbnb.com/terms/payments_terms)) | Help says none ([help](https://www.airbnb.com/help/article/1604)); offer terms name a "guest service fee", not tied to Experiences ([terms](https://www.airbnb.com/help/article/4165)); NV | Typically 20% ([help](https://www.airbnb.com/help/article/3164)) | Full refund to 24h before; 72h for some hosts ([1565](https://www.airbnb.com/help/article/1565), [3874](https://www.airbnb.com/help/article/3874)) | Standard: NV. Originals: request ([help](https://www.airbnb.com/help/article/3407)) | Account needed for "many features" ([ToS](https://assets.airbnb.com/help/2026_Terms_of_Service_for_Users_Outside_of_the_EEA_UK_and_Australia_-_English.pdf)); NV |
| GetYourGuide | Tickets, tours, day trips, transfers ([help](https://www.getyourguide.com/contact)) | Travelers [inferred] | Commercial agent; traveler contracts with supplier ([T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) 3.1, 8.3); card-network status not stated | None found; commission is in the price (T&Cs 3.2). Optional Cancellation Upgrade, fee unpublished ([terms](https://cdn.getyourguide.com/tf/assets/static/checkout/companjon/Companjon_GetYourGuide_TermsAndConditions_EN_NAC_v3.pdf), >12 mo) | No official rate ([supplier site](https://getyourguide.supply/)); third parties say 20% to 30% ([The Traveler](https://www.thetraveler.org/the-business-model-behind-getyourguide-explained/)) [reported] | Free to 24h before for most; listings override (live: 3 days) ([help](https://www.getyourguide.com/contact#cancellation_cancellation-policy)) | Voucher emailed automatically (T&Cs 16.1); request-to-book NV | Likely, via reference plus PIN [inferred]; NV |
| Viator | Tours, activities, attractions ([10-K](https://www.sec.gov/Archives/edgar/data/1526520/000119312526051281/trip-20251231.htm)) | Travelers [documented]; locals not stated | Merchant of record on its own system; agent for revenue purposes ([10-K](https://www.sec.gov/Archives/edgar/data/1526520/000119312526051281/trip-20251231.htm)) | None found; optional "Cancel for any reason" fee ([guidance](https://help.supplier.viator.com/en/articles/407-cancel-for-any-reason-operator-guidance)); NV | No rate published ([agreement](https://help.supplier.viator.com/en/articles/317-supplier-agreement)); $29 per-product submission fee ([help](https://help.supplier.viator.com/en/articles/344-understanding-our-submission-fee-and-viator-launch-assist)) | 100% refund 24h+ before ([help](https://help.supplier.viator.com/en/articles/153-what-is-the-cancellation-policy), >12 mo) | Instant, instant then manual, or manual with 48h ([help](https://help.supplier.viator.com/en/articles/160-how-does-booking-confirmation-work), >12 mo) | Not verified (site blocked) |
| CourseHorse | Classes, workshops, tastings ([home](https://coursehorse.com/)) | Mostly locals (browsed by city) [inferred] | Not stated; acts like one [inferred] ([terms](https://coursehorse.com/termsofuse)) | "No Booking Fees" on one listing ([example](https://coursehorse.com/nyc/classes/art/painting/paint-and-sip/byob-paint-sip-workshop-midtown1)); 5% off full refunds on 9 of 9 listings opened ([example](https://coursehorse.com/nyc/classes/cooking/baking/cake-decorating/cake-decorating-1011)); tax NV | Per-enrollment fee, in-account, not public ([terms](https://coursehorse.com/termsofuse)) | None; provider sets it, free text ([terms](https://coursehorse.com/termsofuse)) | Per-date Book buttons suggest instant [inferred] | NV |
| ClassBento | Art, craft, food and drink workshops ([UK](https://classbento.co.uk/)) | Locals and gift buyers [documented]; no traveler targeting found | Buyer-teacher contract; processor takes payment; not either side's agent ([T&C](https://classbento.co.uk/terms-and-conditions) 15, 21) | None found (T&C 16.3); checkout total NV | 20%, or 3.9% plus a fixed amount via widget ([teach](https://classbento.co.uk/teach)) | None; teacher picks a tier label (T&C 16 to 17) | Public classes instant; private classes instant or request ([FAQ](https://classbento.co.uk/contact)) | FAQ treats accounts as optional; NV |
| Cozymeal | Classes, private chefs, food tours ([home](https://www.cozymeal.com/)) | No data; reads local [inferred] | Terms: a venue, not a party (§1); escrow ([Terms](https://www.cozymeal.com/legal/terms-of-use)); merchant of record not verified | Terms: none; "Service Fee $ 4.99" on 4 of 17 listings ([example](https://www.cozymeal.com/cooking-class/28746/sushi-making--date-night)); NV | Rate not public (Terms §4(b)); 20% to 30% per [SideHusl](https://sidehusl.com/cozymeal/) [reported, >12 mo, unsourced; not verified] | Full refund to 48h before (Terms §4(d)) | Sources disagree; NV | NV |
| 57hours | Multi-day hiking, biking, ski, climbing, sailing ([home](https://www.57hours.com)) | Destination travelers [inferred] | "Not a party"; merchant of record not stated ([terms](https://57hours.com/terms-of-use/), >12 mo) | "Booking fees" of 4.5% to 6.0% in the flow, not in "From" ([flow](https://57hours.com/product/mountaineering-presidential-traverse/)) | Guide keeps 75% ([guide page](https://guide.57hours.com/join)); 25% take [inferred] | Guide-selected. Standard sample: full refund in first 48h, 70% at 60 to 90+ days (50% at 120+ on one camp), then 0 ([example](https://57hours.com/adventure/traverse-mountaineering-nh/)) | "Reserve now" beside "Send inquiry"; instant vs request NV | None found; account auto-created |
| TourRadar (comparable) | Multi-day tours ([help](https://support.tourradar.com/en/customers/is-my-deposit-refundable)) | n/c | n/c | n/c | "Commission fee", rate not stated ([help](https://help.tourradar.com/en/operators/does-tourradar-charge-a-cancellation-fee)) | Operator sets it ([help](https://support.tourradar.com/en/customers/is-my-deposit-refundable)) | n/c | n/c |

## Fees and business models

| Variant | Used by | Trade-off |
|---|---|---|
| Operator-paid commission inside one price | Airbnb, GetYourGuide, ClassBento, CourseHorse | One clean guest price. Rate changes land on operators: some GetYourGuide operators were told of a rise from 20% to 30% in 2025 ([Arival](https://arival.travel/article/getyourguide-commission-increasing-for-some-operators)) [reported, >12 mo] |
| Platform-set retail on a net rate | Viator | Payout stays at net; Viator keeps sole discretion over retail price ([update](https://operatorresources.viator.com/updated-supplier-agreement-august-2026/)), so price can differ by channel |
| Guest fee on top | 57hours; some Cozymeal listings; Airbnb unsettled | Second revenue line. The 57hours "From $1,250" excludes it; step 1 shows $1,306.25 ([detail](https://57hours.com/adventure/traverse-mountaineering-nh/)) |
| Paid cancellation add-on | GetYourGuide, Viator, 57hours | Extra revenue, softer cancellation. Viator's fee is unpublished; help mockups show +$24.00 on $317.48, illustrative ([guidance](https://help.supplier.viator.com/en/articles/407-cancel-for-any-reason-operator-guidance)). 57hours Protection adds about 10% or 18% ([flow](https://57hours.com/product/mountaineering-presidential-traverse/)) |
| Deposit or pay-later | 57hours (30% deposit); GetYourGuide (charged 72h before, [help](https://www.getyourguide.com/contact#payment-and-refunds_reserve-now-&-pay-later)); Viator (2 days before, [help](https://help.supplier.viator.com/en/articles/194-understand-reserve-now-and-pay-later), >12 mo) | Lower commitment at booking; gated to free-cancel listings; a failed payment cancels the booking |

## Booking flow on a phone

Detail pages were read at or near 375px (CourseHorse's bar range at desktop width). Later steps come from help centers and terms; Viator's traveler pages were blocked.

**Common sequence** [inferred]: a card with price and next dates ([Cozymeal](https://www.cozymeal.com/san-francisco/food-tours)); a detail page with a cancellation line and a date list or picker; date, time, party and option (GetYourGuide: party, date, language, option and time, details, optional Cancellation Upgrade, payment, [help](https://www.getyourguide.com/contact)); payment, sometimes with a deposit or pay-later choice; confirmation by email or voucher.

**Where players differ**

- Dated session lists on Airbnb ([page](https://www.airbnb.com/experiences/4218000)), CourseHorse (39 dates with "8 left", [page](https://coursehorse.com/nyc/classes/art/painting/paint-and-sip/byob-paint-sip-workshop-midtown1)) and 57hours ([listing](https://57hours.com/premium-adventures/sailing-and-skiing-lyngen-alps/)); a calendar, then times, on GetYourGuide ([help](https://www.getyourguide.com/contact)).
- Request flows cover custom dates and private groups: Cozymeal "Request Your Own Date" in 24 to 48 hours ([tour](https://www.cozymeal.com/food-tour/18095/explore-chinatown-and-little-italy)); Airbnb by message ([help](https://airbnb.com/help/article/2644/how-do-i-request-to-book-a-new-date-or-time-for-an-experience)).
- Cozymeal's page says "You won't be charged yet"; its Terms allow charging in full before the event (§4(a)). NV.

| Pattern | Seen | Gap |
|---|---|---|
| Sticky bar | Price plus one button on Airbnb ("Show dates"), GetYourGuide ("Check availability", hidden while the inline picker shows), Cozymeal ("BOOK NOW"), CourseHorse (Book Now), ClassBento (Buy or Gift) and 57hours ("Reserve now", after scrolling) | Viator NV; Airbnb scroll behavior NV |
| Holds and timers | None found on Airbnb, GetYourGuide, Cozymeal or 57hours. Viator's partner API has an optional hold, duration unstated ([article](https://partnerresources.viator.com/?p=1973), >12 mo). Scarcity cues are soft ("Only N spots left") | Traveler-facing countdown NV |
| Express pay | Apple Pay is listed by GetYourGuide ([help](https://www.getyourguide.com/contact#payment-and-refunds_payment-methods)), Airbnb ([help](https://www.airbnb.com/help/article/1014), does not name experiences), ClassBento ([FAQ](https://classbento.co.uk/contact)) and Cozymeal (Terms §4(q)). CourseHorse shows an "Express Checkout" label | Placement in the flow NV |
| Guest checkout | 57hours: none found. ClassBento FAQ: accounts optional. Airbnb ToS: account needed for many features | NV for Viator, CourseHorse, Cozymeal |
| Cancellation terms before paying | Airbnb: chip, bar line, "Things to know". GetYourGuide: badge above the picker. Cozymeal: one line on 12 of 17 listings, also at checkout and in email ([page](https://www.cozymeal.com/legal/cancellation-information)). 57hours: summary line and protection cards | CourseHorse: accordion below the fold. ClassBento: checkout and email only. Viator: reviewers differ ([Destinationless](https://destinationlesstravel.com/is-viator-legit-review/), >12 mo); TINA found strict terms behind a "non-refundable" label ([TINA](https://truthinadvertising.org/articles/viators-free-cancellation-claims/), 2025-11-06) |

## Cancellation and refund norms

| Topic | Norm | Spread and gaps |
|---|---|---|
| Default window | 24h before start: Airbnb ([help](https://www.airbnb.com/help/article/1565)), GetYourGuide ([T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) 10.4), Viator ([help](https://help.supplier.viator.com/en/articles/153-what-is-the-cancellation-policy), >12 mo). 48h: Cozymeal ([Terms](https://www.cozymeal.com/legal/terms-of-use) §4(d)) | Inside the window, no refund unless an exception applies. CourseHorse and ClassBento set no default |
| Tiers | Airbnb adds 72h for some hosts. Viator adds Moderate and Strict for select multi-day products (help above). ClassBento uses a label: of 22 listings sampled, 11 allowed free cancellation 2 to 10 days out, 9 reschedule only, 2 no changes (non-random; [UK](https://classbento.co.uk/junk-percussion-stomp-workshop-london), [US](https://classbento.com/terrarium-building-workshop-conroe)) | CourseHorse is free text, from all sales final to 100% back to 5 days ([a](https://coursehorse.com/nyc/classes/cooking/cooking-techniques/pasta-making/handmade-pasta--couples---byob-), [c](https://coursehorse.com/nyc/classes/cooking/dessert-pastry/macaron/french-macarons--gluten-free-recipe-)); one page contradicts itself ([page](https://coursehorse.com/san-diego/classes/art/painting/beach-combing)) |
| Cost on cancel | CourseHorse listings often give credit only and deduct 5% from full refunds (platform-applied [inferred]); a Chicago school keeps 15% ([page](https://coursehorse.com/chicago/classes/cooking/baking/bagel-making/bagel-brunch1)). 57hours booking fees are non-refundable after 48h on Standard ([page](https://57hours.com/adventure/myoko-ski-holidays/)) | Cozymeal team-building listings deduct a venue fee ([example](https://www.cozymeal.com/team-building/22955/traditional-mexican-cooking)) |
| Operator cancels | Airbnb: automatic full refund; host may be charged 20% ([policy](https://www.airbnb.com/help/article/2278), [fees](https://www.airbnb.com/help/article/2039)). GetYourGuide: another date, else full refund in 3 to 5 business days ([help](https://www.getyourguide.com/contact#cancellation_cancellation-by-activity-provider)) | GetYourGuide's T&Cs 1 disclaim it (conflict). Cozymeal's rule is unpublished (Terms §4(j)). 57hours covers weather only ([terms](https://57hours.com/terms-of-use/), >12 mo) |
| Weather, minimum, no-show | Weather: Airbnb refunds a guest only if weather prevents the activity ([help](https://www.airbnb.com/help/article/1593)); most Cozymeal food tours run rain or shine ([tours page](https://www.cozymeal.com/san-francisco/food-tours)). No-show: no refund under GetYourGuide's fallback (T&Cs 10.4) | No platform states a refund for an unmet minimum group; CourseHorse's macaron listing implies one. Not verified for the rest, or for Viator's weather terms |
| After the event | Airbnb: report covered issues within 72h (policy above). ClassBento: report within 4 hours, refund at its discretion ([T&C](https://classbento.co.uk/terms-and-conditions) 17.5). Cozymeal: complaint within 24h, "sole discretion" (Terms §4(j)) | GetYourGuide excludes withdrawal rights for dated leisure activities ([T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) A6.4). Legal floors are deferred |

## Confidence and caveats

- **No live checkout on any platform.** Everything past the detail page comes from help centers, terms and third parties.
- **Viator is the weakest read:** viator.com returned a bot check; most evidence is supplier or partner help, much of it >12 mo.
- **Small samples.** One live listing each for Airbnb and GetYourGuide; 6 for 57hours; 17 for Cozymeal; 9 for CourseHorse's refund line; 22 non-random ClassBento listings.
- **Old or undated:** CourseHorse help (2015 to 2023), 57hours terms (Mar 2024), Airbnb relaunch coverage (May 2025), GetYourGuide's commission report (Jun 2025), SideHusl. ClassBento's T&C, FAQ and teach pages are undated.
- **Likely to change:** Viator's cancel-for-any-reason rollout and US sales-tax handling ([help](https://help.supplier.viator.com/en/articles/398-us-states-where-viator-handles-taxes)); Airbnb's Tripadvisor inventory, terms undisclosed ([release](https://tripadvisor.mediaroom.com/2026-08-11-Tripadvisor-Group-and-Airbnb-Announce-Experiences-Partnership)), and policy tests ([help](https://www.airbnb.com/help/article/2972)); CourseHorse terms, updated 2026-10-01.
- **Conflicts:** GetYourGuide T&Cs vs help on supplier-cancel refunds; Viator's operator guide vs its agreement; 57hours' visible Lyngen policy vs a hidden FAQ.
- **Commission ranges:** Cozymeal's 20% to 30% (SideHusl) and 57hours' press range of 20% to 30% ([The Hustle](https://thehustle.co/news/this-platform-connects-adventure-seekers-with-trusted-guides), 2026-04-22) name no source. GetYourGuide's 20% to 30% is third-party and not verified on any live GetYourGuide page.

Fact-check pass, 2026-10-16 (fees, prices, cancellation). Counts overlap in places, so do not sum them.

| Teardown | Checked | Confirmed | Corrected | Unverifiable |
|---|---|---|---|---|
| Airbnb Experiences | 15 | 8 | 7 | 7 |
| GetYourGuide | 13 | 12 | 6 | 7 |
| Viator | 13 | 5 | 8 | 5 |
| CourseHorse and ClassBento | 15 | 11 | 4 | 7 |
| Cozymeal | 15 | 8 | 6 | 6 |
| 57hours | 14 | 11 | 7 | 6 |

## Not covered yet

Deferred to later research:

- Supply side and how hosts get inventory in
- Market size and trends
- Search, discovery, and SEO surfaces
- Detail page content beyond the booking widget
- Other competitors (Klook, Headout, Eventbrite, Peek, and others)
- Legal and consumer-law floors

## Source files

- [Airbnb Experiences](teardowns/airbnb-experiences.md)
- [GetYourGuide](teardowns/getyourguide.md)
- [Viator (Tripadvisor)](teardowns/viator.md)
- [CourseHorse and ClassBento](teardowns/local-classes.md)
- [Cozymeal](teardowns/cozymeal.md)
- [57hours and TourRadar](teardowns/outdoor-guided.md)
