---
title: Ramble marketplace PRD
status: DRAFT v0.3, for client sign-off
date: 2026-10-18
author: ramble-pm
approver: Dave, as the client
sources: client brief (docs/product/discovery/sealed/client-brief.md, cited as B§n, so B§8.5 is section 8 item 5), market scan (docs/product/market/market-scan.md, cited as MS), decisions log (docs/plan/DECISIONS.md, cited as D yyyy-mm-dd), build plan (docs/plan/BUILD-PLAN.md)
---

# Ramble marketplace PRD

## How to read this

- IDs: requirements `PRD-##`, goals `G#`, constraints `C-##`, assumptions `A-##`, risks `RK-##`, open questions `Q-##`. ADRs and plan units cite these IDs.
- Priority is for launch: **Must** (launch fails without it), **Should** (launch is weaker without it; cut in the order in section 10; two carry a note: PRD-34 becomes a Must if Q-13 says the sponsor needs gift cards, and PRD-54 is never cut), **Later** (not in launch scope).
- Client facts carry their brief section. Our proposals as the consultant are marked **[proposed]** and need the client's yes. Where a requirement turns on an open decision it says "Depends on Q-##", and the Q-## row lists it under "Blocks".

## 1. Summary

- Ramble is a Brooklyn-born media business (newsletter, Instagram, city guide) that sends hosts tens of thousands of clicks a month and captures almost none of the value. It wants guests to book and pay for local experiences on Ramble itself. (B§1)
- Launch is New York City only, mobile-first web. The founder wants a native app at launch but would drop it first if forced to choose; we propose leaving it out (Q-08). (B§6, B§8.14)
- The date that matters is **December 1, 2026**, when a sponsor's holiday gift-guide takeover starts. The sponsor pays $60k on delivery of "bookable experiences on the site." The founder and CFO still need to read the contract to confirm what else, such as gifting or gift cards, the payment needs (Q-13). The stated November 15 launch has no plan behind it. (B§6.3, B§7, B§8.2, B§9.6)
- Several business decisions are still open inside the client team. The biggest is who the seller of record is, which shapes payments, gifting, refunds, and tax (Q-01). No lawyer is engaged yet (Q-16).
- Success: 150 live hosts by launch plus 90 days, 1,000 bookings in the first 60 days, and the monthly numbers the seed investor has asked for, with "real GMV" by the end of Q1 2027. (B§5)

## 2. Problem and context

**Today.** Ramble started in March 2022 as a Sunday newsletter and became "the friend who always knows what to do in Brooklyn." Every listing links out to the host's own booking page or Instagram DMs. Revenue comes from sponsored newsletter slots, affiliate links, and one-off brand deals. (B§1)

| Measure | Value |
|---|---|
| Newsletter | 68,000 subscribers, 41% average open rate, about 3.2% click rate (B§1) |
| Instagram | 112,000 followers (B§1) |
| Website | about 90,000 monthly visitors: 60% newsletter, 22% organic search (about 20,000), 12% Instagram, 6% other (B§1, B§8.9) |
| Devices | 78% of newsletter clicks are on mobile, about 70% of those on iPhone (B§8.14) |
| Revenue, last 12 months | $410k: sponsorships $290k, affiliate $85k, brand partnerships $35k. Net loss about $180k (B§1) |
| Cash | about $640k, stated as roughly 11 months of runway at current burn. These two figures do not reconcile with the net loss (Q-19). (B§1) |
| Team | 6 people, none in engineering; finance is a part-time fractional CFO. Current site is a hosted site builder with a listings plugin (B§1, B§2) |
| Hosts | about 320 in the guide; the COO has spoken to about 90 (B§4) |

**Why now.** Two hosts say Ramble sends them more bookings than their own ads, and Ramble earns almost nothing from it. Investors want proof of a transaction business before the next raise. (B§1, B§5)

**Business model as the client describes it.** A 15% commission on each booking, paid by the host; hosts on other platforms typically pay 20 to 30%, so 15% is the pitch. A buyer service fee of about $2 to $3 is under debate. Average ticket about $65 a person, range $20 (a coffee tasting) to $180 (a boat charter or pottery series), average party 2.3. Who is merchant of record, the payout schedule, and the refund policy are all undecided. (B§3)

**The problem to solve.** A newsletter reader who finds something they want to do has to leave Ramble, land on a host page that may not show availability, and book or DM there. Ramble loses the sale, the data, and the relationship.

## 3. Stakeholders, users, and jobs to be done

**Client stakeholders** (B§2, B§5, B§7)

| Person | Role | Cares about | Holds |
|---|---|---|---|
| Maya Okafor | Founder and CEO | Brand feel, hosts loving Ramble, runway | Leans to Ramble collecting payment; leaned to mandatory accounts at first; wants one cancellation policy; wants a native app, wishlists, and reviews at launch |
| Marcus Bell | COO, head of partnerships | Hosts paid on time, a manageable support inbox | Host as seller with a commission; guest checkout; weekly payouts after the session; promised hosts white-glove setup |
| Priya Nair | Head of growth and marketing | List growth, attribution, holiday launch, SEO | Ramble collecting payment; mandatory accounts; likes the buyer fee |
| Tom Beckett | Fractional CFO, part-time | Margin, tax, cash | Host as seller; delayed payouts to cover refunds |
| Lena Ortiz | Freelance designer | Made the logo and illustrations | |
| Colin Park | Partner at Lantern Row Ventures (seed investor) | "Real GMV" by the end of Q1 2027; monthly numbers | |

**Users**

| User | Who they are | Jobs to be done |
|---|---|---|
| **Guest** | A New Yorker, usually arriving from a newsletter link on a phone. (B§8.14) | Find something good to do this week; check it is on and has space; book it for me and a friend in a few taps. |
| **Gift buyer** | Buying an experience for someone else. Gift-related searches spike in November and December. (B§8.2) | Give a specific experience, or a gift card, with a message and a delivery date. |
| **Group organizer** | Team events or birthdays for 8 to 30 people; about 15% of host inquiries today, often invoiced. (B§8.3) | Ask for a private session for my group and pay the way my company pays. |
| **Host** | A small operator: ceramics or cooking studio, walking guide, kayak or bike outfitter, wine or cocktail class, yoga or sound bath, kids' art. No more than 15 minutes a week of admin, will not double enter availability, will not join if Ramble's fee is above what they pay now. Larger studios have front-desk staff. (B§4, B§8.16) | Fill my sessions without extra admin; know who is coming; get paid reliably; choose cancellation terms that fit my business. |
| **Ramble ops** | The COO and the support inbox: about 60 emails a week now, mostly "is this still on?", expected to reach 300 a week, with no support person. (B§8.10) | Onboard hosts, handle cancellations and refunds, keep the inbox manageable. |
| **Ramble growth** | The head of growth. (B§2, B§8.13) | Grow the list, attribute bookings to their source, keep organic traffic through the move. |
| **Ramble finance** | The fractional CFO. (B§2) | Know what Ramble owes, holds, and earns; limit tax and refund exposure. |
| **Ramble editorial** | The founder and editorial team. (B§2, B§6) | Curate Ramble Picks and keep the site feeling like Ramble. |
| **Investor** (indirect) | Lantern Row, a seed investor, through its partner. (B§1, B§5, B§8.13) | See GMV, take rate, and repeat rate each month. |

## 4. Goals and success metrics

| ID | Goal | Metric and target | Source |
|---|---|---|---|
| G1 | Supply | 150 live hosts by launch plus 90 days; about 400 live experiences. A launch-day minimum is set separately (Q-14). | B§3, B§5 |
| G2 | Demand | 1,000 bookings in the first 60 days after launch | B§5 |
| G3 | Revenue | $100k gross bookings in "the first quarter" (window to confirm: Q-22) | B§5 |
| G4 | Audience conversion | 25% of newsletter subscribers (about 17,000 people) visit the marketplace in the first 90 days. Measured with subscriber-level links (PRD-58), which count only consented subscribers, so the result is a lower bound; the newsletter platform's unique-click report is the cross-check. | B§5 |
| G5 | Sponsor deal | Bookable experiences live on the site by December 1, 2026, when the takeover starts. Gifting is assumed to be part of the deliverable until Q-13 says otherwise. | B§7, B§8.2 |
| G6 | Investor proof | Monthly GMV, bookings, take rate, and repeat rate from launch (PRD-59), and the GMV level the Lantern Row partner calls "real" by the end of Q1 2027 (threshold: Q-21) | B§5, B§8.13 |
| G7 | Keep existing traffic [proposed] | Organic search visitors fall by no more than 10% in the 60 days after the move (baseline about 20,000 a month) | B§8.9 |

**Guardrails** [proposed], monitored monthly: support emails per 100 bookings; refund rate; chargeback rate (target below 0.5% of transactions); checkout conversion from experience page (PRD-61); newsletter opt-in rate at checkout, so list growth has a number (PRD-15).

**Notes on the targets.**
- The brief gives three timings for the 150 hosts: a "launch target" (B§3), "launch plus 90 days" (B§5), and the COO's belief that about 150 will sign up "in the first six months" (B§4). G1 uses the client's accepted 90-day number; the COO's view makes it at risk (A-01).
- G2 and G3 may not agree. 1,000 bookings at a party of 2.3 and $65 a head is about $150k in 60 days, which beats G3 early if "first quarter" means the first 90 days after launch. If it means calendar Q1 2027, the two measure different windows.
- The forecast behind the plan (1,800 bookings a month by month 6, about $270k gross and $40k commission a month) is the head of growth's. The CFO thinks it is optimistic by half. The newsletter-to-booking conversion rate is unknown until a test runs (A-02). (B§3, B§9.3)

## 5. Non-goals for launch

| Not in launch | Why | Source |
|---|---|---|
| Native iOS or Android app [proposed] | The founder wants one at launch but would drop it first if forced to choose. 78% of newsletter clicks are mobile and arrive from email links, which a mobile-first web app serves. (Q-08) | B§6, B§6.1, B§8.14 |
| Building for cities beyond New York | The founder says don't build for 2027 cities now. PRD-63 keeps the door open without building anything. | B§7 |
| Importing Google or Instagram reviews [proposed] | The founder assumes she can import them; the COO says hosts don't want that, and the brief's position is that only verified bookers should review. (Q-09) | B§8.15 |
| Host self-serve sign-up [proposed] | The COO promised hosts white-glove setup; the founder assumes hosts will sign up in a few minutes. (Q-10) | B§4 |
| Wishlists [proposed] | The founder wants them at launch; they are her second cut if forced to choose. | B§6 |
| Two-step checkout | Single-page checkout decided. | D 2026-09-28 |
| A cart, or several sessions in one checkout [proposed] | One session per checkout keeps the flow short; a gift buyer buying several gifts checks out once per gift. | [proposed] |
| Upsells and add-ons [proposed] | Maya and Priya cite them as a reason for Ramble to collect payment; none is scoped for launch. | B§2 |
| Multi-session series and per-group pricing [proposed] | Such as a pottery series, or a boat charter that may be priced per group (our inference). Charters go through private requests (PRD-35). (Q-17) | B§3 |
| Real money in this demo build | Payments run in test mode. See section 11. | BUILD-PLAN |

## 6. Requirements by funnel section

### 6.1 Discovery: home, browse, search

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-01 | Must | The home page is the main discovery surface, built from editorial modules the Ramble team arranges without a developer [proposed]. | D 2026-09-16 |
| PRD-02 | Must | Guests can browse and filter experiences by category, neighborhood, and date. | B§6 |
| PRD-03 | Must | **Ramble Picks:** staff-curated collections with editorial copy, shown on the home page and on their own pages. | B§6, B§6.4 |
| PRD-04 | Must | The brief does not say what the gift-guide takeover consists of (Q-13). [proposed]: a gift guide page and home module present giftable experiences, with whatever sponsor placement the Harbor & Hearth contract requires. Depends on Q-13. | B§7, B§8.2 |
| PRD-05 | Must | When filters return nothing, the guest is told why and offered a way forward (other dates, nearby neighborhoods, related categories), so no search is a dead end. [proposed] | |
| PRD-06 | Should | More filters: price, age suitability (kids, 21+), indoor or outdoor, group size, wheelchair access. [proposed] | B§7, B§8.4 |
| PRD-07 | Should | Keyword search. [proposed] | |
| PRD-08 | Later | Map view. [proposed] | |

### 6.2 Experience and guide pages

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-09 | Must | Each experience page shows photos, description, host, neighborhood and meeting point, duration, price per person, what is included, age rules, venue accessibility (such as step-free access), reviews when shown (PRD-32), and upcoming dates with spaces left. | B§6, B§7, B§8.4; layout [proposed] |
| PRD-10 | Must | The cancellation terms that apply are visible on the page before the guest starts checkout. Depends on Q-04. | B§8.6, MS |
| PRD-11 | Must | On a phone, the booking action stays reachable while the guest scrolls the page. [proposed] | B§8.14, MS |
| PRD-12 | Must | Outdoor experiences are labeled, and each states a weather policy chosen by the host from a fixed set (for example "runs rain or shine" or "go or no-go decided by a stated time before start"). [proposed options] | B§8.5 |
| PRD-13 | Must | Guide entries for hosts who are not bookable on Ramble stay as editorial pages that link out to the host, clearly marked as not bookable on Ramble, and become bookable when the host goes live. Depends on Q-15 (affiliate links). [proposed] | B§1, B§4, B§8.9 |

### 6.3 Booking and checkout

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-14 | Must | A guest books one dated session for a chosen party size on a single checkout page. Pricing is per person. Depends on Q-17. | D 2026-09-28, B§3 |
| PRD-15 | Must | **Guest checkout:** booking never requires an account. The guest gives an email and can opt in to the newsletter; the opt-in, its time, and its source are recorded. Depends on Q-02. [proposed] | B§2, B§6.2 |
| PRD-16 | Must | Ramble never sells more spaces than the host has made available to Ramble. While a guest pays, their spaces are held for a stated time that the guest can see [proposed: 10 minutes]. If the hold lapses before payment, the guest is told and can try again. [proposed] | B§2 (the COO worries the site will promise what hosts can't deliver) |
| PRD-17 | Must | One guest or device cannot hold more than 6 spaces at once, and 3 unpaid holds within 15 minutes trigger a 15-minute block. The payment provider's fraud screening (risk rules, and 3-D Secure where offered) is on for every booking. [values proposed] | B§8.11 |
| PRD-18 | Must | Payment by card, Apple Pay, and Google Pay. Apple Pay matters because about 70% of mobile newsletter clicks are on iPhone. Depends on Q-01. [proposed] | B§8.14, MS |
| PRD-19 | Must | The experience page shows the per-person price. Before paying, the guest sees one total with any fee and any tax itemized, and that total is the amount charged. Nothing is added after that screen. Depends on Q-03 and Q-12. [proposed] | B§3, MS |
| PRD-20 | Must | If a payment is declined or fails, the guest is told what happened and can retry or use another payment method without losing their hold while it lasts. [proposed] | |
| PRD-21 | Must | If the spaces sell out before the guest's hold is placed, or the hold lapses and the spaces are gone, the guest is told before paying and shown other dates. [proposed] | |
| PRD-22 | Must | A guest is never charged twice for one booking, including on a flaky connection or a double tap. [proposed] | B§8.11 |
| PRD-23 | Must | **Age rules.** 21+ experiences say ID is checked at the door, and the booker confirms every attendee is 21 or over. Kids' experiences record one age per child within the allowed range and a parent or guardian's contact details; each experience states whether children count toward capacity and whether they are priced differently. For a gift, the recipient confirms at redemption. | B§8.4; details [proposed] |
| PRD-24 | Must | At checkout the guest accepts Ramble's marketplace terms. Where the host requires a liability waiver (for example outdoor, kids', or physical experiences), the booker accepts the host's waiver text, and the acceptance shows on the host's guest list (PRD-45). [mechanism proposed; the brief names waivers as a CFO concern] Depends on Q-16. | B§7 |
| PRD-25 | Must | Confirmation page, and a confirmation email sent within 5 minutes of booking, with date, time, meeting point, party, the itemized total paid, cancellation terms, and an add-to-calendar link. Depends on Q-12. [timing proposed] | B§6 |

### 6.4 After booking

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-26 | Must | From a link in the confirmation email, a guest can view and cancel their booking without an account and gets the refund the cancellation terms allow. Depends on Q-04. [proposed] | B§8.6, B§8.10 |
| PRD-27 | Must | A reminder email goes out 24 hours before the session (within an hour either side), or at booking if booked later. It says the session is on as of sending, and for weather-dependent sessions it says when the final call is made and how guests are told. [proposed] | B§8.5, B§8.10 |
| PRD-28 | Must | When a host or Ramble cancels a session, every guest is emailed within 5 minutes, refunded in full without having to ask, and shown other dates of the same experience with a link to book. Hosts cancel outdoor sessions today with as little as two hours' notice, so this has to work same-day. [proposed] | B§8.5 |
| PRD-29 | Must | Review collection: after the session, verified bookers are invited to review, and reviews are stored. A verified booker is the email on a paid, non-refunded booking for a session that took place; for a gift, the recipient. Collecting from day one means reviews exist when display ships. Depends on Q-09. [proposed] | B§8.15 |
| PRD-30 | Should | A guest can move a booking to another date of the same experience within the cancellation terms. [proposed] | |
| PRD-31 | Later | Text message alerts for same-day cancellations. Needs phone numbers and SMS consent, to be specified when it is scheduled. [proposed] | B§8.5 |
| PRD-32 | Should | Review display: reviews show on an experience page once it has at least 5. Depends on Q-09. [threshold proposed] | B§6.4, B§8.15 |

### 6.5 Gifting

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-33 | Must | A guest can buy a specific experience as a gift for a party size. Gifting is the need (B§8.2); the mechanics are [proposed]: recipient name and email, a message, and a delivery date; the recipient gets a branded gift email within 5 minutes of the delivery time and picks a date. Rules [proposed]: the gift is worth the price paid for that party size; it is valid for 12 months; if the experience has no open dates in that time or is discontinued, the recipient can switch to another experience (paying or being refunded the difference) or the buyer is refunded; an unredeemed gift is refunded to the buyer at 12 months; refunds before redemption go to the buyer; after redemption the booking follows PRD-26; age rules apply at redemption (PRD-23). Ramble holds the gift money until redemption: as the seller under Q-01 option (a), or as the host's agent under (b) and (c), which counsel must confirm. Depends on Q-01 and Q-13. | B§8.2 |
| PRD-34 | Should, Must if Q-13 requires | Gift cards for a money amount, redeemable on any experience. The brief calls gift cards "central to" the sponsor deal. A gift card holds money not tied to a host, which fits Ramble being the seller (Q-01 option a) better than the agent model. Depends on Q-01 and Q-13. | B§8.2 |

### 6.6 Groups and private bookings

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-35 | Should | Private and group bookings. The need: groups of 8 to 30 are about 15% of host inquiries, often invoiced (B§8.3). [proposed]: an organizer sends a request with date, size, and budget for a private session of any size, which is also how charters priced per group are booked (Q-17). It reaches the host and Ramble ops. At launch the deal is settled off-site and invoiced, so it earns no commission through Ramble and is outside GMV (PRD-59) unless ops records it. If this is cut, these inquiries go to the host directly, as today. Depends on Q-17. | B§8.3 |
| PRD-36 | Later | Online quote, deposit, and invoice payment for group bookings. | B§8.3 |

### 6.7 Accounts

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-37 | Should | An optional guest account (email sign-in link, no password) shows past and upcoming bookings. Depends on Q-02. [proposed] | |
| PRD-38 | Later | Wishlists. [proposed] | B§6 |

### 6.8 Host side

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-39 | Must | Ramble ops can set up a host and their experiences on the host's behalf (white-glove onboarding). Depends on Q-10. | B§4 |
| PRD-40 | Should | Ops can import a host's experiences and sessions from a spreadsheet. [proposed] | B§4 |
| PRD-41 | Must | For hosts who keep their availability on Ramble: a host with 3 experiences and 10 sessions a week can publish a week of sessions in 5 minutes or less, measured in usability testing. Capacity cannot drop below what is already booked; a change of time on a booked session runs the cancellation flow (PRD-28); a price change applies only to new bookings. [measures proposed] | B§4 |
| PRD-42 | Must | **No per-session double entry, for every host.** Hosts on a booking system (about 35% of the 90 hosts the COO knows) either connect it (PRD-43) or give Ramble an allocation. Hosts on a spreadsheet or calendar with DMs (about 40%) either keep their availability on Ramble (PRD-41) or give an allocation. Hosts on Eventbrite (about 25%) run one-off events; Q-11 decides between a connection and entering each event once on Ramble with an allocation. An allocation is a seat count per recurring session (for example every Saturday at 10 am, 6 seats), set once with ops and changed only when the host wants; Ramble generates the dates, so there is no weekly per-session entry. Ramble only sells what it holds; spaces sold elsewhere are the host's to reconcile. Acceptance: a host on an external system finishes setup with ops in 20 minutes or less and then needs no weekly entry. Depends on Q-11. [approach and measures proposed] | B§4, B§8.1 |
| PRD-43 | Should | A live connection to the host's booking system, for systems the spike finds workable. Depends on Q-11. | B§8.1, B§9.1 |
| PRD-44 | Must | A host is emailed within 5 minutes of each booking and cancellation. [proposed] | B§6 (host dashboard), B§8.4 |
| PRD-45 | Must | A host sees each session's guest list with party size, age details, waiver acceptance, and contact details, and can print or share it for the day of the session. | B§8.4, B§8.16 |
| PRD-46 | Must | A host chooses cancellation terms from Ramble tiers that span at least "full refund up to 24 hours before start" to "no refund within 7 days of start." Hosts who don't choose get the default: full refund up to 24 hours before start, the norm among the competitors scanned (MS). The terms show on the host's pages. Depends on Q-04. [proposed] | B§8.6 |
| PRD-47 | Must | Hosts are paid on a published schedule with Ramble's commission taken out, and can see what they are owed and when. Each statement shows gross, commission, fees, refunds, and the payout. Depends on Q-01, Q-03, Q-05, Q-06, Q-12. | B§3, B§8.8 |
| PRD-48 | Should | A host can give front-desk staff their own access. If this is cut, larger hosts share one login. | B§8.16 |
| PRD-49 | Later | Host self-serve sign-up and listing. Depends on Q-10. | B§4 |

### 6.9 Ramble operations

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-50 | Must | Ramble staff approve hosts and experiences before they go live; check photos against a minimum standard (at least 1,600 pixels on the long edge, and a reviewer checklist that rejects screenshots and app interface chrome) [proposed]; set each experience's tax treatment (PRD-78); and edit editorial content, Ramble Picks, the gift guide, and home page modules. | B§6, B§7, B§8.12 |
| PRD-51 | Must | Ramble staff can cancel sessions, refund bookings in full or in part, and see each booking's history (who did what, when). Depends on Q-01 and Q-06. | B§8.5, B§8.10 |
| PRD-52 | Must | Each host's agreement records Ramble's right to use their photos and descriptions; the record is a click-through acceptance collected by ops at onboarding (PRD-39). For the photos Ramble's own team shot (about 60 hosts), ownership and reuse terms are recorded. A bookable listing without a record cannot go live. Guide-only pages (PRD-13) without a record stay live under a takedown-on-request rule until the host signs, an exposure accepted in RK-11. [mechanism proposed] Depends on Q-16. | B§8.12 |
| PRD-53 | Must | Marketplace terms, a privacy policy, and the host agreement are published. Guest acceptance is recorded at checkout (PRD-24); host acceptance at onboarding (PRD-39). [proposed] Depends on Q-16. | B§7 |
| PRD-54 | Should, do not cut | Help pages answering the common questions (is it still on, how to cancel, where to meet) are linked from every email. They are the main defense against support load (RK-04). | B§8.10 |
| PRD-55 | Should | A record of each payment dispute or chargeback: who responded, the evidence, the outcome. Evidence goes in within the payment provider's response window, sent by whoever Q-18 names. Depends on Q-18. | B§8.11 |
| PRD-56 | Must | A finance export with one row per booking: gross, tax, commission, processing fee, refunds, host payout amount, payout status and date. It reconciles to the payment provider's payouts. Depends on Q-01, Q-03, Q-05, Q-12. [proposed] | B§2, B§3 |
| PRD-57 | Should | A view of money held for future sessions and unredeemed gifts, so finance can see refund exposure. Depends on Q-05. [proposed] | B§2 |
| PRD-78 | Must | Each experience has a tax treatment (taxable, not taxable, unknown), set by Ramble ops or finance at approval (PRD-50). Taxable experiences show a tax line at the configured rate (PRD-19). At launch, unknown is treated as not taxable and flagged in the finance export (PRD-56) until Q-12 is answered. [proposed] Depends on Q-12. | B§7, B§8.7 |

### 6.10 Measurement

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-58 | Must | Every booking records its source (newsletter issue, Instagram, search, other) using the last non-direct visit within 30 days [proposed model]. Newsletter links carry the issue, and, where the subscriber has consented, an identifier so unique subscriber visits can be counted for G4. Follows the consent rules in PRD-73. | B§5, B§8.13 |
| PRD-59 | Must | A monthly investor report from launch. Definitions [proposed]: GMV is the ticket value of bookings before tax and fees (the same base as the commission, Q-03), shown before and after refunds; gift purchases count when redeemed, with gift sales shown separately; invoiced group deals are excluded unless ops records them as paid. Take rate is commission divided by GMV. Repeat rate is the share of guests, identified by verified email, with two or more bookings to date. Depends on Q-03. | B§5, B§8.13 |
| PRD-60 | Should | A live dashboard of the PRD-59 numbers (the head of growth's ask). | B§8.13 |
| PRD-61 | Must | Funnel counts: experience views, checkout starts, and bookings, so the real conversion rate is known. G2 rests on it. | B§9.3 |
| PRD-62 | Should | Cohort retention: repeat bookings by month of first booking. | B§8.13 |

### 6.11 Search engines and the move from the current site

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-63 | Must | Adding a second city in 2027 does not require changing any existing page address. The founder says not to build for other cities now; this rests on the investor's 2027 expectation and needs the client's confirmation. [proposed] | B§7 |
| PRD-64 | Must | Every current page with organic search visitors in the last 12 months keeps its address or permanently redirects to its closest new equivalent (an experience page, a guide page from PRD-13, or a category page). Guide content moves with it. Depends on Q-15. | B§8.9 |
| PRD-65 | Must | Category, neighborhood, and Ramble Picks pages are indexable, with editorial copy written for searches like "things to do in Brooklyn." | B§8.9 |
| PRD-66 | Should | Experience pages describe themselves to search engines in a form that can earn rich results (dates, price, and rating once PRD-32 ships). [proposed] | |

## 7. Non-functional requirements

All values in this section are [proposed] unless a source says otherwise.

| ID | Priority | Requirement | Source |
|---|---|---|---|
| PRD-67 | Must | **Devices and browsers.** Designed for a 390-pixel-wide phone first, then wider screens. Supported: iPhone Safari and the in-app browsers of Instagram and mail apps; Android Chrome; current desktop Chrome, Safari, Firefox, and Edge. Apple Pay works wherever Safari supports it. | B§8.14, D 2026-09-28 |
| PRD-68 | Must | **Fast on phones.** Home, browse, and experience pages meet Google's "good" Core Web Vitals at the 75th percentile on mobile: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less. Checked before launch in lab runs (a mid-range Android phone on a throttled 4G connection, on the home, browse, and experience pages) and after launch on the first 28 days of real-user data. | B§8.14 |
| PRD-69 | Must | **Accessible.** WCAG 2.2 AA across guest, host, and admin flows, checked by automated tests and a manual keyboard and screen-reader pass of checkout. The build plan lists WCAG 2.1 AA; 2.2 AA includes it, and the client confirms the version at sign-off. | B§7 |
| PRD-70 | Must | **Newsletter spikes.** The brief supports two estimates of traffic per weekly issue: about 2,200 clicks (68,000 x 3.2%) or about 12,500 visitors (60% of 90,000 a month, over about 4.3 issues). Sized to the higher one until Q-20 settles it: with 12,500 visitors in the 3 hours after a send, PRD-68 thresholds hold and at least 99% of checkouts complete, not counting card declines. | B§1 |
| PRD-71 | Must | **Availability.** The booking path is up 99.9% of each month, where up means an experience page loads and a test booking completes. Disaster recovery (PRD-75) is excluded. | |
| PRD-72 | Must | **Card data** never touches Ramble's own servers; the payment provider handles it, keeping Ramble's PCI scope as small as possible. | B§1 (no engineers in house), B§8.11 |
| PRD-73 | Must | **Privacy.** Newsletter opt-in is explicit and recorded. Analytics and attribution respect consent where the law requires it. A privacy policy is published (PRD-53). Children's data is limited to age and a guardian's contact. Hosts may use guest details only to run the booking and see only their own guests; Ramble ops sees all. Guests can ask for deletion, except for records Ramble must keep for payments, tax, and disputes, which are kept to the minimum and access-limited. | B§8.4, B§8.13 |
| PRD-74 | Must | **Roles and audit.** Separate access for guest, host owner, Ramble ops, and Ramble admin, plus host staff when PRD-48 ships. Refunds, cancellations, and payout changes are logged with who and when. | B§8.16 |
| PRD-75 | Must | **Disaster recovery.** Booking and payment records are backed up. If the data store or hosting region is lost, service is restored within 24 hours, losing no more than 1 hour of records. | |
| PRD-76 | Must | **Email.** All emails come from an authenticated sending domain so they reach inboxes, and are branded. Timing targets sit in each email's own requirement (PRD-25, 27, 28, 33, 44). | B§6 |
| PRD-77 | Must | **Brand.** Playful, warm, editorial, using the existing logo and illustrations on every guest page and email. The founder, or someone she names, approves the mobile design at the design sign-off against a written tone checklist. | B§6, B§7 |

## 8. Constraints

| ID | Constraint | Detail | Source |
|---|---|---|---|
| C-01 | Budget | $120k to $180k for the initial build ("around $150k"), then about $8k a month | B§7 |
| C-02 | Dates | Stated launch November 15, 2026, with no plan behind it. The Harbor & Hearth takeover starts December 1, 2026, with $60k paid on delivery of "bookable experiences on the site." The Lantern Row partner wants "real GMV" by the end of Q1 2027. | B§5, B§6.3, B§7 |
| C-03 | Runway | Stated as about 11 months on $640k at current burn. Does not reconcile with the net loss (Q-19). Any change to burn changes the rating of RK-01 and RK-07. | B§1 |
| C-04 | Team | 6 people, none in engineering; finance is part-time | B§1, B§2 |
| C-05 | Market | New York City only at launch | B§6 |
| C-06 | Legal | No lawyer engaged on marketplace terms. NYC sales tax applies to some classes and admissions and not others; nobody has mapped which. Host liability waivers are a concern. | B§7, B§8.7 |
| C-07 | Design | A freelance designer made the logo and illustrations; no design system exists | B§7 |
| C-08 | Business model | 15% commission paid by the host (base to confirm in Q-03); buyer fee of $2 to $3 under debate; hosts elsewhere pay 20 to 30%. Average about $65 a person; range $20 to $180 (the brief does not say whether the top end is per person); party about 2.3. | B§3 |
| C-09 | Demo build | No real money moves: payments in test mode. Hosts, experiences, and payouts are seeded or simulated. | BUILD-PLAN |

## 9. Assumptions and risks

**Assumptions** (each unverified, with who checks it)

| ID | Assumption | Check | Owner |
|---|---|---|---|
| A-01 | About 150 hosts sign up at a 15% commission. This is the COO's belief over six months; G1 asks for it in 90 days. | Host interviews | Marcus |
| A-02 | Newsletter readers book on Ramble at a rate that supports G2. | A conversion test | Priya |
| A-03 | Hosts on booking systems can share availability, or accept an allocation. | The Q-11 spike | Marcus |
| A-04 | Ramble cancellation tiers are acceptable to most hosts. The COO says hosts will refuse a single policy; tiers are untested. | Host interviews | Marcus |
| A-05 | 15% is attractive. It may not be for hosts who sell direct today and pay little, since hosts won't join if Ramble's fee is above what they pay now. | Host interviews | Marcus |

**Risks**, highest first

| ID | Risk | Effect | Mitigation |
|---|---|---|---|
| RK-01 | December 1. Today is October 18; November 15 is four weeks away and December 1 six. | Missing the takeover may cost the $60k (Q-13) and the gift season. | Plan to December 1 with a range estimate; cut in the section 10 order; treat November 15 as aspirational. |
| RK-02 | Seller of record unresolved (Q-01), and no lawyer engaged (Q-16). | Blocks payments, gifting, refunds, tax, terms, and waivers. | Engage counsel now; decide Q-01 before the payments ADR. |
| RK-03 | Gift cards and the agent model pull against each other. | If the sponsor needs gift cards and Ramble picks the agent model, gift cards need a separate answer. | Read the contract this week (Q-13); decide Q-01 with it in hand. |
| RK-04 | Support load climbs from 60 to 300 emails a week with no support hire. | Ops drowns; hosts and guests churn. | PRD-26, PRD-27, PRD-28, PRD-54. |
| RK-05 | Onboarding capacity: white-glove setup of 150 hosts and about 400 experiences by the COO's team (ops headcount unconfirmed). 150 hosts in 90 days is about 12 a week; minutes per host to confirm with Marcus. | G1 slips; launch-day catalog is thin. | Spreadsheet import (PRD-40); start from the ~60 hosts Ramble has already photographed; set a launch-day minimum (Q-14). |
| RK-06 | Hosts on booking systems may be unable to share availability (Marcus's rough 35% of the 90 he knows), and every host can sell the same seats elsewhere. | Double entry, which hosts refuse; overselling. | Spike first (Q-11); allocation model (PRD-42). |
| RK-07 | The CFO thinks the forecast is optimistic by half. | Revenue plan and runway both off. | Watch PRD-59 and PRD-61 monthly from launch. |
| RK-08 | Organic traffic lost in the move (about 20,000 visitors a month). | Growth stalls at launch. | PRD-64 redirect map; PRD-13 guide pages. |
| RK-09 | Payouts after the session shock small hosts used to being paid at booking. | Hosts leave or refuse to join. | Decide Q-05 with hosts in the room; publish the schedule. |
| RK-10 | Chargebacks and fraud on a business that has never taken payments. | Losses and processor risk. | Provider fraud screening and hold limits (PRD-17), PRD-22, PRD-55; Q-18. |
| RK-11 | Photo and description rights unrecorded. | Takedown or legal exposure. | PRD-52 gate. |
| RK-12 | NYC sales tax not mapped. | Under- or over-collection. | Q-12; each experience carries a tax treatment (PRD-78), so launch does not wait on the full map. |

## 10. Open questions and decisions the client owes

"Needed by" refers to the plan's phases: P2 is the technical decision records, P3 is design, P4 is the plan and estimate.

| ID | Question | Who holds what | Our recommendation | Owner | Needed by | Blocks |
|---|---|---|---|---|---|---|
| Q-01 | Who is the seller of record? (a) Ramble sells; (b) host sells, Ramble takes a commission; (c) host sells, Ramble collects payment as the host's agent | Maya and Priya lean to Ramble collecting; Tom and Marcus to the host selling. Maya: "let's say it's open." | (c), the model Airbnb and GetYourGuide use (Viator is merchant of record; MS confidence is moderate), pending counsel. It gives guests one Ramble checkout while limiting the exposure the CFO worries about. If the sponsor needs gift cards, they need (a) or a separate answer (RK-03). | Tom, with counsel | P2 | PRD-18, PRD-33, PRD-34, PRD-47, PRD-51, PRD-56 |
| Q-02 | Accounts required to book? | Priya wants mandatory accounts for list growth; Maya sided with her at first; Marcus says hosts and customers will hate it. Maya would allow guest checkout with email opt-in if shown evidence. | Guest checkout with opt-in, tracking the opt-in rate as a guardrail. Evidence: 78% of newsletter clicks are mobile and arrive from email links; gift recipients will not have an account when they first redeem; checkout is a single page. The market scan could not verify competitors' guest checkout, so the case rests on these. | Maya, with Priya | P3 | PRD-15, PRD-37 |
| Q-03 | Buyer fee, and the commission's base | Priya likes a $2 to $3 fee; Maya fears it. Commission base and who pays card processing fees are unstated. | No buyer fee at launch: the host-paid 15% is the pitch, and most of the competitors scanned show one operator-paid price, though 57hours and some Cozymeal listings add a guest fee (MS). Commission on the ticket price before tax; processing fees inside Ramble's 15%. | Maya, Tom | P3 | PRD-19, PRD-47, PRD-56, PRD-59 |
| Q-04 | Cancellation policy | Maya wants one Ramble-wide policy; Marcus says hosts will refuse. Hosts today range from 24 hours flexible to no refunds within 7 days. | Ramble tiers that span that range, with full refund up to 24 hours before start as the default (PRD-46). | Maya, Marcus | P3 | PRD-10, PRD-26, PRD-46 |
| Q-05 | Host payout timing | Marcus wants weekly after the session; hosts are used to being paid at booking; Tom prefers a longer delay to cover refunds. | Weekly after the session, explained to hosts before they sign. | Marcus, Tom | P2 | PRD-47, PRD-56, PRD-57 |
| Q-06 | Who funds refunds when a host or the weather cancels? | Nobody has decided. Outdoor experiences, the ones weather cancels, are about 25% of the catalog (B§8.5). | The host refunds in full; Ramble returns its commission. | Marcus, Tom | P2 | PRD-47, PRD-51 |
| Q-07 | Which launch date is real? | November 15 is stated, with no plan behind it; December 1 is the takeover. | Plan to December 1; the P4 estimate says what fits. | Maya | P4 | Launch scope |
| Q-08 | Native app at launch? | Maya wants one; she would drop it first if forced. | Later, after mobile web data. | Maya | P3 | Non-goal |
| Q-09 | Reviews at launch? | Maya wants them on day one and assumes she can import them; Marcus says hosts don't want imports; the brief says only verified bookers should review. | Collect from day one (PRD-29), show at 5 or more (PRD-32), never import. | Maya, Marcus | P3 | PRD-29, PRD-32 |
| Q-10 | Host onboarding | Marcus promised white-glove; Maya assumes hosts sign up in minutes. | White-glove at launch; self-serve later. | Maya, Marcus | P3 | PRD-39, PRD-49 |
| Q-11 | Can FareHarbor, Peek, Acuity, Mindbody, and Square share availability with Ramble, and how do Eventbrite hosts list? | Nobody has checked. | A spike: for each system, can Ramble read availability and write bookings, at what cost, within what limits. Exit when each has a yes, no, or "partner program needed." | Marcus, with the build team | P4 | PRD-42, PRD-43 |
| Q-12 | Which NYC experiences carry sales tax, and are listed prices tax-inclusive? | Tom knows some are taxable and some are not; not mapped. | Each experience carries a tax treatment (taxable, not taxable, unknown); show tax as a line before payment (PRD-19). | Tom, with counsel | P3 for display; launch for the map | PRD-19, PRD-25, PRD-47, PRD-56, PRD-78 |
| Q-13 | What exactly must be live for the Harbor & Hearth payment? | Tom knows about the payment; Maya minimizes it; neither has confirmed what it requires (B§9.6). | Read the contract this week: bookable experiences only, or also gifting, gift cards, sponsor placement, or a minimum catalog? | Maya, Tom | Now | G5, PRD-04, PRD-33, PRD-34 |
| Q-14 | How many hosts and experiences must be live on launch day? | Not discussed. | Start from the ~60 hosts Ramble has already photographed; confirm against Q-13. | Marcus | P4 | G1 |
| Q-15 | Guide listings for hosts who are not bookable, and the affiliate revenue ($85k last year) | Not discussed. | Keep them as guide pages that link out, with affiliate links where they exist, until the host goes live. | Maya, Priya | P3 | PRD-13, PRD-64 |
| Q-16 | Who engages a lawyer, and by when? Needed for terms, the host agreement, waivers, content rights, and the seller-of-record question. | No lawyer engaged yet on marketplace terms (B§7); Tom is to settle the seller-of-record question with a lawyer (B§9.2). | Engage now; it gates Q-01 and Q-12. | Tom | Now | PRD-24, PRD-52, PRD-53 |
| Q-17 | Multi-session series and per-group pricing at launch? (A pottery series; a boat charter, possibly priced per group.) | Not discussed. | Per-person single sessions at launch; charters through group requests (PRD-35); series later. | Marcus | P3 | PRD-14, PRD-35 |
| Q-18 | Who bears a chargeback, and who answers a dispute? | Tom worries about disputes; follows from Q-01. | Decide with Q-01. | Tom | P2 | PRD-55 |
| Q-19 | What is the current monthly burn? 11 months on $640k is about $58k a month; last year's $180k net loss is about $15k a month. | Stated figures conflict. | Confirm before the estimate is judged against runway. | Tom | P4 | C-03 |
| Q-20 | How many visitors does one newsletter issue send, and how fast? | Two estimates (PRD-70). | Pull the numbers from the newsletter and site analytics. | Priya | P2 | PRD-70 |
| Q-21 | What GMV and metrics does the Lantern Row partner expect by the end of Q1 2027? | Maya has his words and has not shared them. | Get his exact wording; set G6's number from it, and check G3 against it. | Maya | P4 | G6, G3 |
| Q-22 | Does "first quarter" in G3 mean the first 90 days after launch or calendar Q1 2027? | Unstated. | First 90 days after launch. | Maya | P4 | G3 |

**Cut order.** If the P4 estimate shows the Musts don't fit December 1, Shoulds go first, in this order. It starts with the founder's own give-up order (native app and wishlists are already out; reviews on day one are next), then our proposals nobody on the client side asked for (2 to 5), then the head of growth's analytics asks (6 and 7), then the rest by least effect on launch risk (8 to 14):

1. PRD-32 review display (collection stays)
2. PRD-37 guest accounts
3. PRD-07 keyword search
4. PRD-66 rich results
5. PRD-30 move a booking
6. PRD-62 cohort retention
7. PRD-60 live dashboard (the monthly report stays)
8. PRD-06 extra filters
9. PRD-57 money-held view
10. PRD-55 dispute record
11. PRD-43 live booking-system connection
12. PRD-40 spreadsheet import
13. PRD-35 group requests
14. PRD-48 host staff access

Not cut: PRD-54 help pages (support load). PRD-34 gift cards stay until Q-13 is answered; if Q-13 says the sponsor does not need them, they go first.

If cutting every Should still doesn't fit, launch in two releases. Three Musts are not needed until the first sessions have run and can follow within 30 days: PRD-29 (review invites can go out late), PRD-56 (the finance export), and PRD-59 (the first monthly report is due a month in). Everything else ships first, including whatever Q-13 says the sponsor payment needs (at least PRD-04 and PRD-33, plus PRD-34 if required). Beyond that, a Must moves only with the client's agreement.

## 11. This engagement and the demo build

Ramble is a demo marketplace built to prove a planning method. This PRD is written as it would be for the client. Where the demo build departs from it (test-mode payments, seeded hosts and experiences, simulated payouts and integrations, no real support inbox or counsel), `docs/plan/BUILD-PLAN.md` governs. A requirement stays in the plan even when the demo simulates it, so the estimate reflects the real job. If the no-cart non-goal stands, the P3 states page drops its "empty cart" state; Dave reconciles this at the P3 gate.

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Client | Dave | | |
