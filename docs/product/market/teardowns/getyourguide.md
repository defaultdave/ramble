# GetYourGuide teardown

Researched 2026-10-16. Basis labels: [documented] [reported] [inferred].

"Live" means the mobile detail page (375x812 emulation), read without opening any picker or checkout.

## 1. Snapshot

- Tours and activities marketplace: tickets, guided tours, day trips, transfers, city cards, multi-day trips. No flights or packages. [documented: [help center](https://www.getyourguide.com/contact), "What does GetYourGuide offer?"]
- Run by [GetYourGuide Deutschland GmbH, Berlin](https://www.getyourguide.com/c/general-terms-and-conditions/). Traveler-first: help copy centers on trips and vacations, and no local-resident positioning was found. [documented, inferred]
- Self-reported scale: 200,000+ activities, 37 languages and currencies. [documented, marketing: [supplier site](https://getyourguide.supply/)] Revenue near EUR 1B and profitable, October 2025. [reported: [Venturelab](https://www.venturelab.swiss/GetYourGuide-reaches-profitability-and-nears-1-billion-in-revenue), snippet only, page failed to load]

## 2. Fees and business model

| Topic | Finding | Basis |
|---|---|---|
| Legal role | Commercial agent for suppliers. The contract is between traveler and supplier, and GetYourGuide collects payment on the supplier's behalf. ([T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) 3.1, 8.3) Residents of the US, Canada, Australia, UK and Switzerland pay a local GetYourGuide entity that processes and collects the payment (8.7). Card-network merchant-of-record status is not stated. | documented |
| Traveler fees | No separate service fee found. The supplier-paid commission sits inside the posted price. (T&Cs 3.2) Reviewers report no booking fee. ([Pilot Plans](https://www.pilotplans.com/blog/getyourguide-review), updated 2025-12-23) | documented, reported |
| Price display | "From" price with a struck-through price on the one listing read (live: $69 struck, $55) and on both "You might also like" cards ($88 struck, $44; $133 struck, $66). What the struck price compares against is not stated (not verified). The From price can depend on activity time, date or option, and may apply only above a group size. ([help](https://www.getyourguide.com/contact), "Pricing and discounts") Posted prices are "in most cases" all-in; local taxes or fees are disclosed in the activity description. (T&Cs 16.2.1) | documented, live |
| Other charges | The traveler's own payment service provider may charge fees (T&Cs 8.5), and GetYourGuide may charge a "reasonable" exchange fee for highly volatile currencies (8.3). Some activities carry fees payable on arrival, listed in "Know before you go". ([help](https://www.getyourguide.com/contact#payment-and-refunds_payment-methods)) Cancellation Upgrade is a paid add-on; its fee is not published in the [terms](https://cdn.getyourguide.com/tf/assets/static/checkout/companjon/Companjon_GetYourGuide_TermsAndConditions_EN_NAC_v3.pdf) (no printed date; file created 2025-09-11 per its metadata, older than 12 months). The fee shown at checkout is not verified (needs a live checkout). | documented |
| Invoices | GetYourGuide issues no tax invoice; the provider issues VAT invoices. GetYourGuide can issue a proof of payment or payment confirmation. (T&Cs 8.1; [help](https://www.getyourguide.com/contact#payment-and-refunds_proof-of-payment-and-VAT-invoice)) | documented |
| Operator commission | Charged only on successful bookings; rate varies by country and is shared after sign-up. The live page gives no number. ([supplier site](https://getyourguide.supply/)) The supplier portal itemizes commission by pricing category and payment modifier, with no rates published. ([supplier help](https://supply.getyourguide.support/hc/en-us/articles/30401036915229-Understanding-the-New-Commission-Breakdown-System), updated 2026-04-29) Numbers are third-party: about 20-30% of booking value ([The Traveler](https://www.thetraveler.org/the-business-model-behind-getyourguide-explained/), 2025-10-17, 364 days old at check), 20-35% negotiated with an account manager ([Magpie](https://about.magpie.travel/how-to-work-with/get-your-guide), undated). | documented, reported |
| Commission shift | Some operators were notified on 2025-06-03 of a rise from 20% to 30% effective 2025-07-03 (per one operator email shown in the article), and operators reported rates reaching or passing 30%. GetYourGuide called it a targeted adjustment affecting a small number of supply partners. At least one increase was cancelled after the operator contacted support. ([Arival](https://arival.travel/article/getyourguide-commission-increasing-for-some-operators), posted 2025-06-10, updated 2025-07-07, older than 12 months) A search found no 2026 report of a further change (absence of evidence only). | reported |
| Payouts | Supplier site: monthly at no extra cost, or "bi-monthly" with a small surcharge; each run pays fulfilled bookings minus commission. ([supplier site](https://getyourguide.supply/)) Supplier help center: the second option is bi-weekly, two runs a month, at +2% on top of the contractual commission. Monthly runs pay on the 5th business day; bi-weekly runs pay on the 5th and 20th (next business day if a weekend or holiday). Bookings are paid by travel date. ([supplier help](https://supply.getyourguide.support/hc/en-us/articles/14148314384029-Monthly-and-Bi-Weekly-Payment-Cycle), updated 2026-05-27) Magpie (undated) says the 5th monthly, or the 5th and 20th for +2%; the +2% matches, and "the 5th" is the 5th business day per GetYourGuide. | documented, reported |

Search snippets of the supplier page `/join/how-much-does-getyourguide-charge` show "20-30%" by country and payouts "twice a month or monthly" with no extra processing fees. That URL now redirects to the supplier home page (checked 2026-10-16), whose live text has no range and describes the bi-monthly surcharge, so the snippets look stale. The 20-30% is not verified on any live GetYourGuide page (not verified).

## 3. Booking flow on a phone

| Point | Finding | Source |
|---|---|---|
| Detail page | Rating, then "Free cancellation: Cancel up to 3 days in advance for a full refund", duration, "Check availability to see starting times". | live |
| Sticky bar | Bottom bar: from-price, "Likely to sell out" tag, one "Check availability" button. It stays while scrolling and was absent when the inline picker was on screen. | live |
| Selection | Inline "Select participants, date, and language" block, then "Check availability". | live |
| Availability | Available dates blue; full or closed dates grey and crossed out. Times appear after a date is chosen. Party size changes availability. No waitlists. ([help: Availability](https://www.getyourguide.com/contact)) | help center |
| Steps | Party, date, language, option and time, personal details, optional Cancellation Upgrade, payment method. ([help: How to book](https://www.getyourguide.com/contact)) | help center |
| Confirmation | Automatic email and voucher with booking reference and PIN. The booking is a binding offer for two working days and GetYourGuide may reject it. (T&Cs 16.1.2, 16.1.4) | help center, T&Cs |
| Instant vs request | Pay-later listings need instant confirmation, so non-instant listings likely exist. Request-to-book not verified (needs a live checkout). | inferred |
| Guest vs account | Cancel and reschedule use reference plus PIN, so guest booking is likely. Not verified (needs a live checkout). | inferred |
| Payment | Cards, PayPal, Google Pay, Apple Pay, Klarna, plus regional methods by country and currency. ([help](https://www.getyourguide.com/contact#payment-and-refunds_payment-methods)) | help center |
| Pay later | 72+ hours lead, free cancellation, instant confirmation. Zero-amount card check at booking, charge 72 hours before, 47 hours to pay manually if it fails, else auto-cancel. ([help](https://www.getyourguide.com/contact#payment-and-refunds_reserve-now-&-pay-later); T&Cs 8.2) | help center, T&Cs |
| Hold or timer | Nothing found. Not verified (needs a live checkout). | none |
| Policy before paying | Badge on the detail page (live), "About this activity" section, Cancellation Upgrade offer at checkout. ([help](https://www.getyourguide.com/contact#cancellation_cancellation-policy)) Checkout display not verified (needs a live checkout). | live, help center |

## 4. Cancellation and refunds

| Topic | Policy | Basis |
|---|---|---|
| Default | Most activities: free cancellation until 24 hours before start. ([help](https://www.getyourguide.com/contact#cancellation_cancellation-policy)) T&Cs fallback: over 24 hours is a full refund; inside 24 hours or no-show is none (10.4). Listings override it (live: 3 days). | documented, live |
| Tiers | Fully, partially or non-refundable, per provider policy. How suppliers choose is not verified. | documented |
| Weather | Supplier may cancel outside the window, with a refund. (T&Cs 16.4.1) Listings state their own stance (live: "rain or shine"). | documented, live |
| Minimum group | No standalone policy found. The help center says some bookings require a minimum number of participants and the activity may not run with a reduced headcount; the detail is in the confirmation email or app booking details. ([help](https://www.getyourguide.com/contact), "Add or remove participants from a booking") What happens when a minimum is not met is not stated (not verified). | documented |
| No-show | No refund under the T&Cs fallback (10.4); a listing or voucher can override it. The help center lists missed activities due to late or canceled flights or trains, traffic or road closures as typically not refundable. ([help](https://www.getyourguide.com/contact#payment-and-refunds_refund-requests)) | documented |
| Host cancels | Provider tries to offer another date or time; if none is available or acceptable, GetYourGuide refunds in full. The refund goes to the original payment method and should show within 3-5 business days, depending on payment method. ([help](https://www.getyourguide.com/contact#cancellation_cancellation-by-activity-provider)) The refund-requests article words it as "may be entitled to a full refund". T&Cs 1 disclaim responsibility for supplier-cancellation refunds, which conflicts with the help center. | documented |
| Reschedule | Instant date or time change with reference plus PIN; price difference shown first; not for all bookings. ([help](https://www.getyourguide.com/contact), "Reschedule booking") | documented |
| Outside policy | Refund requests are considered case by case at GetYourGuide's discretion, with no guarantee. Cancellations arranged directly with the provider off-platform are not eligible. ([help](https://www.getyourguide.com/contact#payment-and-refunds_refund-requests); T&Cs 8.4) | documented |
| Refund method | Original payment method. The traveler can instead choose GetYourGuide refund gift cards, which are non-transferable, expire, and are forfeited if the account is deleted. (T&Cs 10.5, 10.6) Timing: the help center says 3-5 business days in one article and "at least 3-5 business days" in another, and varies by payment method and currency. ([help](https://www.getyourguide.com/contact), "Cancel booking", "Refund not received") | documented |
| Cancellation Upgrade | Optional add-on run with partner Companjon (the terms name AIAJ Services LLC as "We"). Cancel for any reason for a pre-set payout; booked over 24 hours and under 120 days ahead, and booked from outside the UK, Switzerland and the EEA; not insurance. The service fee is paid upfront and its amount is not in the terms. ([terms](https://cdn.getyourguide.com/tf/assets/static/checkout/companjon/Companjon_GetYourGuide_TermsAndConditions_EN_NAC_v3.pdf) 1, 2, 3.2, 4.1) The fee is refunded on withdrawal within 14 days if no payout was requested, on cancelling before the cover period starts, when a reschedule changes the booking price, and when the supplier cancels more than 24 hours out; not when the supplier cancels inside 24 hours (5.1, 5.3-5.5). Terms are undated; file metadata says 2025-09, older than 12 months. | documented |

T&Cs are version 1 Oct 2025 (about 12.5 months old; still the live version on 2026-10-16). Appendix A6.4 excludes the 14-day withdrawal right for leisure activities with a specific date or period, naming tours, day trips, entrance tickets, guided tours, water activities, adventures and other experiences. ([T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) A6.4, non-US residents) [documented]

## 5. Takeaways

- Agent model: the supplier is the seller, and GetYourGuide's commission sits inside one displayed price. Local fees go in a "Know before you go" block.
- Cancellation standardizes on a 24-hour cutoff, with per-listing overrides shown above the picker.
- Post-booking self-service runs on reference plus PIN, with price differences shown before confirming.
- Pay-later is gated by listing traits: instant confirmation, free cancellation, 72-hour lead.
- Commission is one ranking input among several, and suppliers can raise it voluntarily as marketing spend (T&Cs 3.3). 2025 reports show operator friction over rate changes.

## 6. Sources

All accessed 2026-10-16.

- https://www.getyourguide.com/contact (help center; deep links above)
- https://supply.getyourguide.support/hc/en-us/articles/14148314384029-Monthly-and-Bi-Weekly-Payment-Cycle (supplier help, updated 2026-05-27)
- https://supply.getyourguide.support/hc/en-us/articles/30401036915229-Understanding-the-New-Commission-Breakdown-System (supplier help, updated 2026-04-29)
- https://www.getyourguide.com/c/general-terms-and-conditions/
- https://www.getyourguide.com/rome-l33/colosseum-roman-forum-palatine-hill-guided-tour-t195566/ (live detail page)
- https://getyourguide.supply/
- https://cdn.getyourguide.com/tf/assets/static/checkout/companjon/Companjon_GetYourGuide_TermsAndConditions_EN_NAC_v3.pdf
- https://arival.travel/article/getyourguide-commission-increasing-for-some-operators
- https://about.magpie.travel/how-to-work-with/get-your-guide
- https://www.thetraveler.org/the-business-model-behind-getyourguide-explained/
- https://www.pilotplans.com/blog/getyourguide-review
- https://www.venturelab.swiss/GetYourGuide-reaches-profitability-and-nears-1-billion-in-revenue (snippet only)

## Verification

Dated 2026-10-16. Scope: fee, commission, price-display, cancellation and refund statements only. Booking-flow claims were not checked. Each primary source below was opened fresh, not taken from the earlier citation. Pages that returned 403 to plain fetch (T&Cs, help center, listing) were read in the browser pane, reading and expanding sections only.

| # | Claim | Result | Source checked |
|---|---|---|---|
| 1 | Commercial agent; commission inside posted price; no traveler service fee | Confirmed. Added: local entity collects payment for US, CA, AU, UK, CH residents (8.7). | [T&Cs](https://www.getyourguide.com/c/general-terms-and-conditions/) 3.1, 3.2, 8.3, 8.7 (version 1 Oct 2025); [Pilot Plans](https://www.pilotplans.com/blog/getyourguide-review) (updated 2025-12-23) |
| 2 | Commission on successful bookings only; no official number; third-party 20-30% and 20-35% | Confirmed. The 20-30% on the official page is seen only in search snippets of a URL that now redirects. | [supplier site](https://getyourguide.supply/); [The Traveler](https://www.thetraveler.org/the-business-model-behind-getyourguide-explained/) (2025-10-17); [Magpie](https://about.magpie.travel/how-to-work-with/get-your-guide) (no date on page) |
| 3 | 20% to 30% rise notified June 2025, effective 2025-07-03, some reversed | Confirmed with detail added (notified 2025-06-03; reversal confirmed for one named operator). Source older than 12 months. | [Arival](https://arival.travel/article/getyourguide-commission-increasing-for-some-operators) |
| 4 | Monthly free or "bi-monthly" with small surcharge; Magpie 5th and 20th at +2% | Corrected. The surcharge is +2% on the contractual commission, per supplier help. Monthly pays on the 5th business day, not "the 5th". "Bi-monthly" on the marketing page means bi-weekly (two runs a month) in the help center. | [supplier help](https://supply.getyourguide.support/hc/en-us/articles/14148314384029-Monthly-and-Bi-Weekly-Payment-Cycle) (updated 2026-05-27); [supplier site](https://getyourguide.supply/) |
| 5 | Posted prices "in most cases" all-in; local taxes disclosed in description | Confirmed. | T&Cs 16.2.1 |
| 6 | Default free cancellation until 24 hours before; fully, partially or non-refundable | Confirmed. | [help center](https://www.getyourguide.com/contact), "Cancellation policy" |
| 7 | T&Cs fallback: over 24 hours full refund; within 24 hours or no-show none | Confirmed. | T&Cs 10.4 |
| 8 | Colosseum listing: 3-day free cancellation, $55 with $69 struck | Confirmed on re-read (mobile emulation). Variation by time, date and option is documented in help ("Pricing and discounts") and T&Cs 10.4. Variation by currency is not verified. | [listing](https://www.getyourguide.com/rome-l33/colosseum-roman-forum-palatine-hill-guided-tour-t195566/) |
| 9 | Provider cancels: other date or full refund in 3-5 business days; T&Cs 1 conflicts | Confirmed, including the conflict. Help words the timing as "should see" within 3-5 business days. | help center, "Cancellation by activity provider", "Refund requests"; T&Cs 1 |
| 10 | Supplier may cancel for weather, strikes, force majeure, with refund | Confirmed. | T&Cs 16.4.1 |
| 11 | Cancellation Upgrade: upfront fee, amount unpublished, over 24 hours and under 120 days, not insurance, terms dated 2025-09 | Confirmed. The PDF has no printed date; its metadata says created 2025-09-11 and the server shows last modified 2025-09-18. No v4 or v5 at the same path. Refund rules for the fee and the non-UK/CH/EEA booking condition added. | [terms PDF](https://cdn.getyourguide.com/tf/assets/static/checkout/companjon/Companjon_GetYourGuide_TermsAndConditions_EN_NAC_v3.pdf); help center, "Cancellation upgrade" |
| 12 | No tax invoice; VAT invoice is the provider's job | Confirmed. | T&Cs 8.1; help center, "Proof of payment and VAT invoice" |
| 13 | Outside-policy refunds discretionary; off-platform and travel-disruption misses not refunded; original payment method or refund gift card | Confirmed. The refund-method part was missing from the file and is now a row. | help center, "Refund requests"; T&Cs 10.5, 10.6 |

**Changed in this file**

- Payouts row rewritten around the supplier help center (+2%, 5th business day, 5th and 20th).
- Stale-snippet note rewritten; the 20-30% stays unverified.
- Price display: "often struck-through" narrowed to what was seen (three cards on one page); struck-price basis marked not verified.
- No-show: the "no refund" rule now cites T&Cs 10.4. The help article cited before does not mention no-shows.
- Minimum group: help center mention added; the unmet-minimum outcome stays unverified.
- Appendix A6.4: withdrawal right excluded for dated leisure activities. This replaces "effect not verified".
- Added the Refund method row and Cancellation Upgrade fee-refund rules.

**Still unverified**

- Any official commission percentage (only third-party figures and stale snippets).
- Cancellation Upgrade price at checkout (needs a live checkout).
- What the struck-through price compares against.
- Whether prices or cancellation windows vary by currency.
- What happens when a listing's minimum group size is not met.
- Whether "successful" (commission) and "fulfilled" (payout) bookings are the same. The supplier page uses both and the help center pays by travel date.

**Found, not added to the tables**

- Best price matching: refund of the difference at GetYourGuide's discretion for the same activity under identical conditions, which may be issued as a voucher. ([help](https://www.getyourguide.com/contact), "Best price matching"; [Pilot Plans](https://www.pilotplans.com/blog/getyourguide-review))
- T&Cs 16.2.2: the posted price may be higher than the supplier charges for the same activity elsewhere.
- Help center: payment for the activity is not accepted onsite.
