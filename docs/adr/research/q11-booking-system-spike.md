# Q-11 spike: can hosts' booking systems share availability with Ramble?

Researched 2026-10-18 for ADR 0002.

Feeds ADR 0002 (R2, data and holds) and the P4 estimate. Documentation research only. No account, trial, or form was opened or filled. Vendor docs that render in JavaScript were read in a browser pane by navigating and reading. Nothing was called, so every behavior below is as documented, not as observed.

## Question

Can FareHarbor, Peek Pro, Acuity Scheduling, Mindbody, Square Appointments, and Eventbrite (a) show Ramble a host's live availability and (b) accept a booking from Ramble? Each system gets a verdict of yes, no, or "partner program needed", with evidence. Then: what this means for PRD-42 (allocations as the fallback), PRD-43 (live connection, a Should), and whether R2's data model must store external IDs and sync state at launch.

This is the recommendation for the real job. The demo simulates all of it (see "What the demo simulates").

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-42 (Must) | Every host on an external system either connects (PRD-43) or gives an allocation. Q-11 decides what is possible. The allocation path must work for all six systems. |
| PRD-43 (Should) | The live connection itself. Cut-order item 11, so it is already cut-eligible. |
| PRD-14 | One dated session, a party size, per-person pricing. A system that models only 1:1 appointment slots does not fit. |
| PRD-16 | Ramble never sells more than the host made available, with a timed hold. Only some systems can hold. |
| PRD-21, PRD-22 | Sold out is shown before payment, and no double charge. A system with no hold and no idempotency key opens a paid-but-unbookable window. |
| PRD-28 | Host-side cancellations must reach guests within 5 minutes. A live connection needs a webhook or poll for this. |
| PRD-44, PRD-45 | Host email on each booking and a printable guest list. This is how an allocation host learns about Ramble bookings. |
| PRD-70 | Newsletter spikes. Rate limits that are per IP matter when every visitor shares the server's address. |
| PRD-73 | Guest details go to hosts only to run the booking. A connection writes guest data into the host's system. |
| PRD-39, PRD-40 | Ops sets hosts up. Per-host consent and activation steps land on ops. |
| A-03, RK-06 | The assumption and risk this spike tests: hosts on booking systems can share availability or accept an allocation. |
| Q-01, Q-16 | Ramble collects as the host's agent. Vendor distribution terms may assume the vendor handles payment. API terms need counsel. |
| C-09 | No real money or vendor calls in the demo. |

## Options

### What the spike found (evidence for every option)

Verdicts. Detail and links per system follow.

| System | Read availability | Create a booking | Hold with expiry | Access | Verdict |
|---|---|---|---|---|---|
| FareHarbor | Yes, with capacity | Yes (validate, then create) | None documented | Affiliate or software-partner review, certification, per-host approval | **Partner program needed** |
| Peek Pro | Yes, with vacancies | Yes | Yes (OCTO reserve, `ON_HOLD`) | Reseller key by request; no public terms | **Partner program needed** |
| Acuity Scheduling | Yes, with `slotsAvailable` for classes | Yes | None documented | Self-serve API key or OAuth2 client; host needs the Premium plan | **Yes** |
| Mindbody | Yes, with capacity counts | Yes | None documented | Developer account, then Mindbody approval, then owner activation; extra fees for multi-studio apps | **Partner program needed** |
| Square Appointments | Slots only, no seat counts | Yes, for 1:1 services | None documented | Self-serve OAuth app; writes need Plus or Premium on the seller | **No** for seat-based sessions |
| Eventbrite | Yes, ticket class totals | No order-creation call documented; checkout is Eventbrite's widget | None documented | Self-serve token or OAuth | **No** (read only) |

Cost, limits, events, and OCTO.

| System | Cost to Ramble and host | Rate limit | Webhooks | OCTO or an OCTO channel manager |
|---|---|---|---|---|
| FareHarbor | No API fee published. Fees to distributors exist but no amounts are public. Third parties report 20% to 25% of the sale taken from the operator (unverified). | 30 requests per second and 3,000 per 5 minutes, per IP | Booking and item events, set up through FareHarbor support | No FareHarbor OCTO endpoint found. Ventrata (OCTO-native) connects to FareHarbor, but only through FareHarbor's own distributor agreement. |
| Peek Pro | None published | Not documented | `booking_update` only; no availability event | **Yes**, Peek implements OCTO core plus Pricing and Webhooks |
| Acuity | Host pays $55 a month (annual billing) or $69 (monthly) for Premium. API itself has no fee. | Not in official docs; third parties say 10 per second, 20 concurrent | Scheduled, rescheduled, canceled, changed, order completed | None found |
| Mindbody | $0.002 per call (free under 5,000 calls a month). For multi-studio apps add $15 per location, $1.30 per class booking, $2.50 per appointment booking. | Keep to 2,000 per minute or less; 429 calls are not billed | Class, appointment, client, and other events; not billed as calls | None found |
| Square | Host needs Plus ($49) or Premium ($149) per location for writes. API has no fee. | Not published; reactive 429 | `booking.created`, `booking.updated` only | None found |
| Eventbrite | API free. Eventbrite's own fee on a sale is 3.7% + $1.79 per ticket + 2.9% per order, on top of Ramble's 15%. | 2,000 per hour, 48,000 per day | Order, attendee, event, ticket class events; payload is a link only | None found |

#### OCTO in one paragraph

OCTO is an open API specification for tours and activities, run by a member-based not-for-profit that anyone can use without joining ([OCTO docs home](https://docs.octo.travel/)). Core v1.0 was last updated 2023-07-28 (same page; older than 12 months, flagged). The core has availability calendar and check calls and a booking flow of reserve, extend, confirm, and cancel, where a reserved booking sits in `ON_HOLD` until confirmed or expired, and the reservation `uuid` is an idempotency key ([OCTO bookings](https://docs.octo.travel/octo-api-core/bookings.md)). Availability returns `vacancies`, `capacity`, and a status ([OCTO availability](https://docs.octo.travel/octo-api-core/availability.md)). Keys are Bearer tokens, one per reseller and supplier pair ([OCTO authentication](https://docs.octo.travel/getting-started/authentication.md)). An optional Notifications capability defines product, availability, and booking update events that carry IDs only ([OCTO notifications](https://docs.octo.travel/capabilities-optional/notifications.md)). The named implementers I could read are Peek Pro, Zaui, Xola, and Anchor ([Ventrata's list](https://docs.ventrata.com/additional-resources/other-octo-implementations)); OCTO's own implementation list is a spreadsheet I could not read ([OCTO known implementations](https://docs.octo.travel/additional-resources/known-implementations.md)). None of the six systems except Peek Pro appears.

#### FareHarbor: partner program needed

- **Access.** The External API is for affiliates (resellers) and software partners. Requests are reviewed; you email support or, for a distribution affiliate, fill in an application. Live credentials come only after API certification ([FareHarbor Integration Center](https://developer.fareharbor.com/api/external/v1/home)).
- **Certification.** Required: pull ticket pricing, support one user key per currency, support custom fields, call Validate before an instant confirmation, and use the Bookings webhook. Testing means booking every product in a sandbox company, plus one rebook and one cancel (same page).
- **Per-host consent.** The supplier must approve your API access before you can book for them (same page). That is an ops step per host.
- **Availability.** A call returns every bookable availability for one item over a date range, with capacity, customer-type rates, and party-size limits. FareHarbor suggests pulling 90 days in 7-day segments weekly, 30 days daily, and today every 2 hours ([affiliate reference](https://developer.fareharbor.com/api/external/v1/api-reference-affiliates)).
- **Booking.** Validate checks bookability and price and is recommended before taking payment. Create fails if the availability closed or capacity ran out. The body carries `amount_paid` ("collected by the affiliate user"), `external_id`, and `voucher_number` (same page). I found no hold, expiry, or temporary reservation anywhere on the page.
- **Limits.** 30 requests per second and 3,000 per 5 minutes per IP, shared by all keys on that IP; over the limit gives 429 or 403. Requests time out at 60 seconds ([FareHarbor Integration Center](https://developer.fareharbor.com/api/external/v1/home)). Under DATA-12, a server-side fetch must set a cache lifetime because every visitor shares the server's IP.
- **Webhooks.** Booking create, update, rebook, and cancel, plus item updates. FareHarbor staff configure the URL. Failed deliveries are retried and a failing hook can be deactivated (same page). The docs call webhook access "built for Software Partners" yet certification asks affiliates to use the Bookings webhook, so eligibility needs confirming.
- **Cost.** The developer docs publish no fee. Ventrata says FareHarbor charges distributors fees for the connection and gives no amounts ([Ventrata, 2026-08-05](https://support.ventrata.com/en/articles/9532120-fareharbor-operator-connection)). Bókun, a competitor, says FareHarbor takes 20% from the operator for referral-link bookings and 25% for API bookings, and pays affiliates 15% ([Bókun, 2025-06-10](https://www.bokun.io/?p=4479)). Arival reported 20% and 15% in 2021 ([Arival](https://arival.travel/?p=97819)). Treat all of this as unverified.
- **OCTO and channel managers.** No FareHarbor OCTO support found. Ventrata sells FareHarbor operators' products through a distributor connection that needs FareHarbor registration, an agreement, and a FareHarbor user key ([Ventrata](https://support.ventrata.com/en/articles/9532120-fareharbor-operator-connection)). A channel manager does not remove FareHarbor's gate.

#### Peek Pro: partner program needed

- **Access.** The documented API is a reseller API that implements OCTO. Access is by emailing Peek's product team; the page gives no requirements, cost, or sandbox ([Peek request access](https://octodocs.peek.com/getting-started/request-access.md)). Auth is a Bearer key; a bad key returns 403 ([Peek basics](https://octodocs.peek.com/getting-started/basics.md)).
- **Standard.** Peek implements OCTO core plus the Pricing and Webhooks capabilities, always on. The OCTO version is not stated ([Peek introduction](https://octodocs.peek.com/introduction.md), [Peek capabilities](https://octodocs.peek.com/getting-started/capabilities.md)).
- **Availability.** A calendar call is cached and gives a status and total capacity only. A check call gives `vacancies`, `capacity`, and an `id` you book with. No maximum date range is stated ([Peek availability](https://octodocs.peek.com/booking-flow/availability.md)).
- **Booking and hold.** `POST /bookings` creates an `ON_HOLD` booking that reserves the space; `expirationMinutes` is optional and the default is "the supplier default", not stated. Extend, confirm (needs contact name and email), cancel, and update exist. Setting the `uuid` makes a retry safe ([Peek booking](https://octodocs.peek.com/booking-flow/booking.md)). This is the only system in the set that matches PRD-16's timed hold.
- **Webhooks.** One event, `booking_update`, fired when a booking is confirmed, updated, or cancelled. No availability event; retries not documented ([Peek webhooks](https://octodocs.peek.com/capabilities/webhooks.md)). Host-side cancellations (PRD-28) would arrive; a host changing capacity would not.
- **Gaps.** No rate limit, price, or sandbox in the docs. "Product" is defined as an activity or rental, and the docs do not say whether recurring classes fit.

#### Acuity Scheduling: yes

- **Access.** First-party access is HTTP Basic with a user ID and API key from the account's Integrations page ([quick start](https://developers.acuityscheduling.com/reference/quick-start)). For many hosts, an app registers an OAuth2 client at a public page, sends the host through an authorize URL, and gets a Bearer token with scope `api-v1`. The docs describe no approval step ([OAuth2](https://developers.acuityscheduling.com/docs/oauth2)). A scorecard site calls OAuth registration partner-gated ([Supergood](https://supergood.ai/api-report-card/acuity-scheduling)); the official docs say otherwise, so I treat it as open and flag the conflict.
- **Plan.** The pricing page lists "Custom API & CSS for Developers" under Premium only: Starter $16 or $20, Standard $27 or $34, Premium $55 or $69 a month (annual or monthly billing). The page is undated ([Acuity pricing](https://acuityscheduling.com/pricing)). A small host pays this for Ramble's sake, which strains A-05 (hosts will not join if Ramble costs them more than they pay now).
- **Availability.** `GET /availability/dates` and `/times` take an appointment type; the times response is a list of times with no seat count ([times](https://developers.acuityscheduling.com/reference/get-availability-times.md)). For group classes, `GET /availability/classes` returns `slots` and `slotsAvailable` ([classes](https://developers.acuityscheduling.com/reference/get-availability-classes)).
- **Booking.** `POST /appointments` needs `datetime`, `appointmentTypeID`, names, and email. The time must be an open slot or the call returns 400 `not_available`. `admin=true` skips that check. No hold and no idempotency key are documented, and payment is not an input (only a package or coupon `certificate`). A class-specific body is not described ([create appointment](https://developers.acuityscheduling.com/reference/post-appointments)). Ramble's payment would not be recorded in Acuity.
- **Webhooks.** `scheduled`, `rescheduled`, `canceled`, `changed`, and `order.completed`. Set statically in Integrations or through a Webhooks API. Retries run with exponential backoff for 24 hours on 500s and connection errors, and a hook failing for 5 days is disabled. Payloads are signed with an HMAC ([webhooks](https://developers.acuityscheduling.com/reference/webhooks)).
- **Rate limit.** The official pages I read state none. Two integration guides say 10 requests per second and 20 concurrent connections per IP ([Nango, search snippet only](https://nango.dev/docs/integrations/all/acuity-scheduling.md)). Unverified.
- **OCTO.** None found.

#### Mindbody: partner program needed

- **Access.** Create a developer account, build on the free sandbox, request live access (Mindbody reviews and approves), then request an activation code or link for each business and have the owner activate it ([getting started](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/introduction/getting-started), [going live](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/introduction/taking-your-application-live)). Terms are public; the approval gate is Mindbody's. Available to developers working with owners on every subscription level ([FAQ](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/frequently-asked-questions)).
- **Cost.** $0.002 per call, with nothing billed under 5,000 calls in a cycle and every call billed above it. Webhooks are not calls. An app that books across several Mindbody businesses is a "consumer booking network" and pays $15 per location per integration, $1.30 per class booking, and $2.50 per appointment booking ([FAQ](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/frequently-asked-questions)). The page is undated and the portal footer reads 2023. The billing period for the $15 is not stated. Arithmetic from the PRD: a $65 ticket for 2.3 guests is $149.50, 15% of which is $22.43, so $1.30 is about 6% of Ramble's commission on one class booking.
- **Availability.** `GetClasses` lists scheduled classes; the Class model carries `MaxCapacity`, `WebCapacity`, `TotalBooked`, `WebBooked`, and `IsAvailable` ([GetClasses](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/api-endpoints/class/get-classes), [Class model](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/models/structures/class)). It accepts a `lastModifiedDate` filter, which allows incremental polling.
- **Booking.** `AddClientToClass` and `AddAppointment`. The class tutorial books with a staff user token and says all payment and booking restrictions are overridden, so Ramble must check capacity itself and would hold a staff login for each studio ([tutorial](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/tutorials/book-a-client-into-a-class)). The guest must exist as a Mindbody client first (same page), which writes guest data into the studio's CRM (PRD-73).
- **Hold and retry.** None documented. Request deduplication blocks an identical POST only while the first is in progress, for at most 2 minutes ([deduplication](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/request-deduplication)). That is not an idempotency key.
- **Limit.** A 429 exists; Mindbody recommends 2,000 requests per minute or fewer and does not bill 429 responses ([errors](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/handling-errors)).
- **Webhooks.** Among others: `classRosterBooking.created`, `classRosterBooking.cancelled`, `class.updated`, `classSchedule.*`, `appointmentBooking.*`. Events are not stored for later delivery, so a down receiver loses them ([events](https://developers.mindbodyonline.com/ui/documentation/webhooks-api#/http/mindbody-webhooks-api/events)). A poll is needed as a backstop.
- **Churn.** July 2026 release notes add a permission requirement for class cancellation ([release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)).
- **OCTO.** None found. Mindbody is a wellness platform, so the PRD's yoga and sound-bath hosts are the likely users.

#### Square Appointments: no (for seat-based sessions)

- **Access.** An OAuth app. The free plan allows buyer-level bookings only: the app sees and manages only bookings it created and cannot double-book or book outside hours. Seller-level reads and writes need Appointments Plus or Premium, and without it writes fail with 403 ([Bookings API overview](https://developer.squareup.com/docs/bookings-api/what-it-is)). The seller assigns bookable team members in the Dashboard; a developer cannot do that for them ([onboarding](https://developer.squareup.com/docs/bookings-api/onboard-to-the-api)). The docs describe no app review.
- **Plan prices.** Free $0, Plus $49, Premium $149 a month per location, read from the live pricing page on 2026-10-18 ([Square pricing](https://squareup.com/us/en/appointments/pricing)). Guides that show $29 and $69 are stale.
- **Availability.** SearchAvailability takes a range of 24 hours to 31 days and returns slots with a start time, location, team member, and service variation ([use the API](https://developer.squareup.com/docs/bookings-api/use-the-api), [search reference](https://developer.squareup.com/reference/square/bookings-api/search-availability)). There is no seat count, because the model is one customer per team-member slot.
- **Booking.** CreateBooking takes a slot and a customer who has a phone number. A service with a non-zero no-show fee cannot be booked through the API. Hold and payment are not covered ([use the API](https://developer.squareup.com/docs/bookings-api/use-the-api)).
- **Classes.** Square sells class booking with a maximum capacity on Plus and Premium ([Square AU class page](https://squareup.com/au/en/appointments/features/class-booking); US availability not confirmed). The Bookings API docs I read never mention classes or capacity, and a December 2024 developer-forum reply says webhooks cover only individual bookings, none for class-type ones ([forum thread](https://developer.squareup.com/forums/t/webhook-events-for-bookings-of-type-class-plus/20222); the reply is AI-drafted and staff-reviewed). A seller-level app can double-book a slot, so Ramble could write several bookings into one slot, but it cannot read seats left. Capacity would then live only in Ramble, which is an allocation.
- **Webhooks and limits.** `booking.created` and `booking.updated` ([overview](https://developer.squareup.com/docs/bookings-api/what-it-is)). Limits are unpublished and enforced reactively with 429 `RATE_LIMITED` ([forum, search snippet](https://developer.squareup.com/forums/t/proactive-rate-limiting-vs-reacting-to-429s/22135)).
- **OCTO.** None found.

#### Eventbrite: no (read only)

- **Access.** A private token for your own account, or OAuth 2 to act for other users. No approval step is documented ([authentication](https://www.eventbrite.com/platform/docs/authentication)).
- **Read.** An organization's events are listable, and an event expands to its ticket classes, each with `quantity_total`, `quantity_sold`, and `on_sale_status` ([events](https://www.eventbrite.com/platform/docs/events)).
- **No booking write.** I found no call that creates an order in the guides I read; the separate API reference site was not opened. Orders are readable only by the order owner and organization members ([orders](https://www.eventbrite.com/platform/docs/orders)). Buying happens in an embeddable checkout widget keyed by `eventId`, with an `onOrderComplete` callback ([embedded checkout](https://www.eventbrite.com/platform/docs/embedded-checkout)). That would move PRD-14, PRD-15, PRD-18, and PRD-19 into Eventbrite's checkout and add Eventbrite's fee (3.7% + $1.79 per ticket plus 2.9% per order, [organizer pricing](https://www.eventbrite.com/organizer/pricing/)) on top of Ramble's 15%.
- **Webhooks.** Order place, update, refund; attendee update and check-in; event, ticket class, organizer, and venue events. The payload is an `api_url` plus config, so Ramble fetches the object. Non-2xx responses are retried every 10 minutes up to ten more times ([webhooks](https://www.eventbrite.com/platform/docs/webhooks)).
- **Limits.** 2,000 calls an hour and 48,000 a day by default ([rate limits](https://www.eventbrite.com/platform/docs/rate-limits)), set in June 2025 ([changelog](https://www.eventbrite.com/platform/docs/changelog)).
- **Terms.** The API terms (updated 2025-05-30) bar using the APIs to build a product that competes with Eventbrite's ([API terms](https://www.eventbrite.co.uk/support/articleredirect?anum=8483)). A marketplace that sells the same events arguably competes. This is a Q-16 question for counsel; it is a reading, not legal advice.
- **OCTO.** None found.

### Option A: Allocation for every external-system host; no connectors at launch

- **How it works.** Ops records which system the host uses and sets an allocation per recurring session (PRD-42). R2's research note already generates the sessions with `source = 'allocation'`. The host caps or blocks those seats once in their own system. Ramble's hold and `seats_sold` are the only truth for Ramble's seats. The host learns of bookings by email and the guest list (PRD-44, PRD-45).
- **Fit.** Serves PRD-42 for all six systems on the same code path, PRD-16 (the hold is Ramble's own), PRD-21, PRD-22, PRD-39, PRD-40. Eventbrite hosts enter each event once, as PRD-42 already says. It leaves PRD-43 unbuilt. It strains RK-06: the host can still sell a seat Ramble holds if they forget to block it, and under PRD-42 that reconciling is the host's.
- **Cost.** No vendor fee and no approvals. Ops time per host (PRD-42 target is 20 minutes or less). Engineering is the allocation path R2 already designs.
- **Risks.** Host discipline: A-03 is only half tested, because "accept an allocation" is the claim and no host has been asked. Hosts with real-time stock in another channel may refuse a hard cap.
- **Evidence.** The six findings above: no system gives Ramble open, hold-capable, self-serve write access.

### Option B: Direct connectors, self-serve systems first

- **How it works.** Build per-vendor adapters, starting with Acuity (open), then Square for appointment-style services, then Mindbody and FareHarbor after their approvals. Each adapter reads availability on a schedule or by webhook and writes a booking after payment.
- **Fit.** Serves PRD-43 and reduces host-side blocking. Strains PRD-16, PRD-21, and PRD-22, because Acuity, Mindbody, Square, and FareHarbor have no hold and no durable idempotency key, so Ramble can only hold internally and writes after the charge. A write that fails after payment must refund automatically (R2 rule 4 already designs this case). Strains PRD-73 (guest data written into Mindbody clients, FareHarbor contacts, and Acuity records) and PRD-70 (FareHarbor and Acuity limits are per IP).
- **Cost.** One adapter, credential store, consent flow, and test suite per vendor, none estimated here. Vendor-side: Acuity Premium on the host, Mindbody's per-booking and per-location fees, FareHarbor's unpublished fees. Two of the four (Mindbody and FareHarbor) need an approval whose duration no vendor publishes.
- **Risks.** December 1 (RK-01). Four separate sync-failure modes to operate with no support hire (RK-04). Host plan upgrades (A-05).
- **Evidence.** Acuity and Square are open; Mindbody and FareHarbor are gated; both are covered above.

### Option C: An OCTO-shaped availability port plus one OCTO reseller connection (Peek Pro) when access is granted

- **How it works.** R2's DAL port is written as OCTO's four operations: availability check, reserve with expiry, confirm, cancel. Allocation and the fake in-memory store implement it at launch. A Peek adapter is the first real implementation, behind `source = 'external'`. R2's hold states (active, paying, converted, released) map onto OCTO's `ON_HOLD`, `CONFIRMED`, `EXPIRED`, and `CANCELLED` ([OCTO bookings](https://docs.octo.travel/octo-api-core/bookings.md)).
- **Fit.** Serves PRD-43, PRD-16 (a real external hold), PRD-21, PRD-22 (reservation `uuid`), and PRD-28 (`booking_update`). The port costs nothing extra at launch and matches ARCH-2 (one module per external service) and ARCH-3 (wire types stay in the module). It does not need a schema change on `sessions`, `holds`, or `orders`.
- **Cost.** Port design is inside R2's work. The adapter and Peek's terms are unknown (no pricing is published).
- **Risks.** Reaches only Peek hosts, and nobody knows how many there are. OCTO webhooks are partial at Peek (no availability event). Peek's hold default and rate limits are undocumented. The other five systems get nothing from this option.
- **Evidence.** Peek's booking and availability pages above; OCTO core.

## Comparison

| Criterion | A: Allocation only | B: Direct connectors | C: OCTO port + Peek |
|---|---|---|---|
| PRD-42 for all six systems at launch | Yes | Only for connected hosts; A is still needed for the rest | Yes (A is the fallback) |
| PRD-43 coverage | None | Up to four systems, each gated or plan-limited | One system, gated |
| Oversell protection (PRD-16, 21) | Full, inside Ramble's count | Weaker: no hold at four systems, write after payment | Full for Peek hosts; A elsewhere |
| No double charge (PRD-22) | Own keys only | Idempotency is Ramble's job at four systems | Native for Peek |
| Dependence on a vendor decision before Dec 1 | None | Mindbody, FareHarbor approvals | Peek approval, optional |
| Cost to Ramble and hosts | Ops minutes | Adapters, Acuity Premium on hosts, Mindbody fees | One adapter, terms unknown |
| Privacy exposure (PRD-73) | Email only | Guest data written into host systems | Contact name and email to Peek |
| Standards fit | Simple | Many service modules | One service module, OCTO-shaped port |
| Operating burden with no support hire (RK-04) | Lowest | Highest | Low |

## Recommendation

**Launch with Option A, shape the port like Option C, and do not schedule any connector before December 1.**

**Verdicts:** FareHarbor, partner program needed. Peek Pro, partner program needed. Acuity, yes. Mindbody, partner program needed. Square, no for seat-based sessions. Eventbrite, no (read only).

**PRD-42 (allocations).** Keep it as written. It is the only approach that works for all six systems on one code path, and none of the six lets Ramble hold a seat on the host's behalf except Peek, which is gated. Two additions to PRD-42's text: (1) setup includes a one-time capacity cap or block in the host's own system, and the interviews behind A-03 should ask hosts about it directly; (2) ops records the host's system as a label.

**PRD-43 (live connection).** Leave it a Should at cut-order position 11 and plan it as post-launch. The spike gives no reason to promote it: no system is open, self-serve, and hold-capable at once. Acuity is open, but with no hold and a Premium plan on the host. Peek has the best technical fit but needs approval. If a connector is built first, choose it by the number of hosts on each system, not by the vendor's openness. That number does not exist yet: the PRD's 35% of 90 hosts is not split by vendor.

**R2's data model.** Ramble does not need to store external IDs or sync state at launch. Specifically:

1. Keep `sessions.source` with the values the R2 research note already lists (`ramble`, `allocation`, `external`). No change to `sessions`, `holds`, or `orders`.
2. Add one nullable `hosts.booking_system` label, set by ops. It has no behavior. It gives P4 and ops the vendor count, and it records the PRD-42 population.
3. Write the DAL port as OCTO's operations (check, reserve with expiry, confirm, cancel), per Option C.
4. Do not build mapping tables, sync cursors, a webhook inbox, or an outbox of external writes. Add them with the first connector. They differ by vendor: FareHarbor needs a company shortname plus item and per-session availability IDs; OCTO needs a product, an option, and a per-date availability ID; Acuity needs an appointment type and calendar; Mindbody needs a site, location, and class ID; Square needs a location, service variation, and team member. One `external_id` column cannot hold these, which is why a premature column would be wrong. When a connector is chosen, the additive tables are `host_connections` (system, credential reference, consent or activation date, status), `external_refs` (vendor IDs per experience or session), `external_writes` (order, idempotency key, state, attempts, external booking ID), and an inbound-event table with a unique event ID, the same pattern R2 uses for `provider_events`. FareHarbor's `external_id` and `voucher_number` fields and Mindbody's `lastModifiedDate` filter suit correlation and incremental polling.

**For R3.** A connector to a system with no documented hold (every system in the set except Peek Pro) opens a paid-but-unbookable window. R3 should confirm that the chosen flow, including Express Checkout wallets, supports authorizing first and capturing after the external write succeeds. Stripe documents separate authorization and capture for cards, with typical online authorizations lasting 7 days and some Visa cases 5 ([Stripe: place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)). Wallet support was not checked here.

**Next steps that need a human (not done here).** Marcus tallies the roughly 35% of hosts by system. Dave or Marcus emails Peek for access and files FareHarbor's affiliate application so approval lead time runs in parallel with the build. Tom adds the Eventbrite API terms clause to the Q-16 list for counsel.

**What the demo simulates.** The allocation path is real and seeded (`source = 'allocation'`, plus `hosts.booking_system` labels so ops can see the population). No vendor call is made and no key exists. The port is implemented by the in-memory fake R2 already specifies. No `external` rows are seeded. PRD-43 stays in the plan as unbuilt, and the P4 estimate prices one connector as an optional line.

## What would change the call

- **The tally shows one system holds most of the booking-system hosts** and its vendor grants access in time. Then price that connector as a named P4 unit. Peek first if it is Peek (holds, OCTO). Acuity first if it is Acuity.
- **Hosts will not cap or block seats in their own system.** Then PRD-42's allocation fails for those hosts (A-03 fails) and PRD-43 becomes a Must in effect. Re-cut the section 10 order.
- **Peek or FareHarbor approve early and publish terms.** Reopen PRD-43 with real fees and limits.
- **Mindbody's consumer-network fees are stale or wrong.** The page is undated. A confirmed lower fee or a negotiated one moves Mindbody from "defer" toward a candidate.
- **Square documents class capacity in the Bookings API.** Then Square's verdict becomes "yes" for class-style services on Plus or Premium.
- **Eventbrite documents server-side order creation, or counsel clears the competing-product clause.** Then re-check the Eventbrite verdict.
- **Counsel rules the agent model (Q-01 c) is incompatible with a vendor's distribution terms.** FareHarbor's affiliate path implies the affiliate may collect payment, but who settles with the operator is unverified.
- **R3 finds wallets cannot authorize first and capture later.** Then connectors to no-hold systems need a different failure path before PRD-43 is viable.

## Open risks

1. **No test was run.** Everything is documented behavior. Race conditions, error shapes, and real hold defaults are unobserved.
2. **Unverified fee claims.** FareHarbor's 20% and 25% come from a competitor (June 2025) and a 2021 article. FareHarbor's own docs publish no fee.
3. **Mindbody pricing is undated.** The FAQ lists fees without a date, on a portal whose footer reads 2023. The billing period for the $15 per location is not stated.
4. **Acuity.** The rate limit comes from third-party snippets. The Premium-only API gate comes from an undated pricing row, and third parties disagree on the tier. OAuth openness conflicts between Supergood and Acuity's own docs. Class booking through `POST /appointments` is not described in the reference.
5. **Square.** Class support in the API is unconfirmed. The class feature page I read is the Australian one. The forum evidence is from December 2024 and AI-drafted. I did not expand the 2026 release notes.
6. **Peek.** Hold default, rate limits, price, sandbox, and OCTO version are not documented. Access depends on an email reply.
7. **FareHarbor webhook eligibility** is unclear, and certification and approval timelines are unpublished, as are Mindbody's.
8. **Payments and the agent model.** Vendor distribution programs may assume the vendor or the distributor handles payment and settles with the operator. Not resolved for Q-01 (c).
9. **Eventbrite API terms** may bar the use. Counsel decides (Q-16).
10. **Mindbody staff tokens.** The class tutorial books with a staff login. I did not find a narrower credential. That is a credential-custody burden for ops.
11. **PRD-73.** A connection writes guest details into host systems. The privacy policy and host agreement must cover it before any connector ships.
12. **Vendor mix unknown.** The 35% is not split. The build priority cannot be set from this spike.
13. **Source age.** OCTO core v1.0 is from 2023-07-28. The Eventbrite API terms (2025-05-30) and rate-limit change (2025-06) are over 12 months old. The Bókun FareHarbor article (2025-06-10) and the Square forum thread (2024-12) are over 12 months old. The Arival article is from 2021. The Eventbrite orders example data is from 2018. Acuity's pricing page, Mindbody's FAQ, and the FareHarbor and Peek docs carry no date.

## Sources

Retrieved 2026-10-18 unless noted. "Browser" means read in the browser pane because the page renders in JavaScript. "Snippet" means seen only in a search result and not opened.

| Source | Used for | Date or flag |
|---|---|---|
| [OCTO docs home](https://docs.octo.travel/) | What OCTO is, governance, versions | Core v1.0 2023-07-28; older than 12 months |
| [OCTO bookings](https://docs.octo.travel/octo-api-core/bookings.md) | Reserve, extend, confirm, statuses, idempotency | Undated |
| [OCTO availability](https://docs.octo.travel/octo-api-core/availability.md) | Calendar and check calls, vacancies | Undated |
| [OCTO notifications](https://docs.octo.travel/capabilities-optional/notifications.md) | Product, availability, booking updates | Undated |
| [OCTO authentication](https://docs.octo.travel/getting-started/authentication.md) | Bearer key per reseller and supplier | Undated |
| [OCTO known implementations](https://docs.octo.travel/additional-resources/known-implementations.md) | Links to a spreadsheet I could not read | Flag: list not read |
| [Ventrata: other OCTO implementations](https://docs.ventrata.com/additional-resources/other-octo-implementations) | Named implementers | Undated |
| [Ventrata: FareHarbor operator connection](https://support.ventrata.com/en/articles/9532120-fareharbor-operator-connection) | Distributor route to FareHarbor, fees exist | 2026-08-05 |
| [FareHarbor Integration Center (home)](https://developer.fareharbor.com/api/external/v1/home) | Access, certification, limits, webhooks (Browser) | Undated |
| [FareHarbor affiliate reference](https://developer.fareharbor.com/api/external/v1/api-reference-affiliates) | Availability, validate, create, fields (Browser) | Undated |
| [Bókun: FareHarbor Distribution Network](https://www.bokun.io/?p=4479) | Reported 20% and 25% | 2025-06-10; competitor; older than 12 months |
| [Arival: FHDN](https://arival.travel/?p=97819) | Reported 20% and 15% | 2021-10-18; old |
| [Peek: introduction](https://octodocs.peek.com/introduction.md) | OCTO core plus Pricing and Webhooks | Undated |
| [Peek: request access](https://octodocs.peek.com/getting-started/request-access.md) | Access by email | Undated |
| [Peek: basics](https://octodocs.peek.com/getting-started/basics.md) | Bearer auth, 403 | Undated |
| [Peek: capabilities](https://octodocs.peek.com/getting-started/capabilities.md) | Capabilities always on | Undated |
| [Peek: availability](https://octodocs.peek.com/booking-flow/availability.md) | Calendar and check calls | Undated |
| [Peek: booking](https://octodocs.peek.com/booking-flow/booking.md) | Reserve, extend, confirm, cancel | Undated |
| [Peek: webhooks](https://octodocs.peek.com/capabilities/webhooks.md) | `booking_update` only | Undated |
| [Acuity: quick start](https://developers.acuityscheduling.com/reference/quick-start) | Basic auth | Undated |
| [Acuity: OAuth2](https://developers.acuityscheduling.com/docs/oauth2) | Client registration, flow | Undated |
| [Acuity: availability times](https://developers.acuityscheduling.com/reference/get-availability-times.md) | Times, no seat count | Undated |
| [Acuity: availability classes](https://developers.acuityscheduling.com/reference/get-availability-classes) | `slotsAvailable` | Undated |
| [Acuity: create appointment](https://developers.acuityscheduling.com/reference/post-appointments) | Booking, errors, no hold | Undated |
| [Acuity: webhooks](https://developers.acuityscheduling.com/reference/webhooks) | Events, retries, signature | Undated |
| [Acuity pricing](https://acuityscheduling.com/pricing) | Premium-only API row, prices | Undated; flag |
| [Supergood: Acuity](https://supergood.ai/api-report-card/acuity-scheduling) | Conflicting claims on OAuth openness | Third party; header says October 2026; conflicts with official docs |
| [Nango: Acuity](https://nango.dev/docs/integrations/all/acuity-scheduling.md) | Rate limit claim | Snippet only; unverified |
| [Mindbody: getting started](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/introduction/getting-started) | Access steps (Browser) | Footer 2023 |
| [Mindbody: going live](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/introduction/taking-your-application-live) | Approval step (Browser) | Footer 2023 |
| [Mindbody: FAQ](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/frequently-asked-questions) | Fees, consumer booking network (Browser) | Undated; flag |
| [Mindbody: errors](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/handling-errors) | 2,000 RPM, 429 (Browser) | Undated |
| [Mindbody: request deduplication](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/request-deduplication) | In-flight dedupe only (Browser) | Undated |
| [Mindbody: book into a class](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/tutorials/book-a-client-into-a-class) | Staff token, overridden restrictions (Browser) | Undated |
| [Mindbody: GetClasses](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/api-endpoints/class/get-classes) | Class listing, `lastModifiedDate` (Browser) | Undated |
| [Mindbody: Class model](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/models/structures/class) | Capacity fields (Browser) | Undated |
| [Mindbody: webhook events](https://developers.mindbodyonline.com/ui/documentation/webhooks-api#/http/mindbody-webhooks-api/events) | Event list, no replay (Browser) | Undated |
| [Mindbody: release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) | July 2026 permission change | Current to July 2026 |
| [Square: Bookings API overview](https://developer.squareup.com/docs/bookings-api/what-it-is) | Buyer and seller level, plans, webhooks | Undated |
| [Square: use the API](https://developer.squareup.com/docs/bookings-api/use-the-api) | Search range, create booking, restrictions | Undated |
| [Square: onboarding](https://developer.squareup.com/docs/bookings-api/onboard-to-the-api) | Seller setup, no review mentioned | Undated |
| [Square: search availability reference](https://developer.squareup.com/reference/square/bookings-api/search-availability) | Response shape (Browser) | API version 2026-09-16 |
| [Square Appointments pricing](https://squareup.com/us/en/appointments/pricing) | $0, $49, $149 per location (Browser) | Live 2026-10-18; third-party guides show $29 and $69 |
| [Square AU class booking](https://squareup.com/au/en/appointments/features/class-booking) | Class capacity feature | Australian page; US not confirmed |
| [Square forum: class webhooks](https://developer.squareup.com/forums/t/webhook-events-for-bookings-of-type-class-plus/20222) | No class-type webhook | 2024-12; AI-drafted reply; older than 12 months |
| [Square forum: rate limiting](https://developer.squareup.com/forums/t/proactive-rate-limiting-vs-reacting-to-429s/22135) | Reactive 429 | Snippet only |
| [Eventbrite: authentication](https://www.eventbrite.com/platform/docs/authentication) | Token and OAuth (Browser) | Undated |
| [Eventbrite: events](https://www.eventbrite.com/platform/docs/events) | Ticket class quantities (Browser) | Undated |
| [Eventbrite: orders](https://www.eventbrite.com/platform/docs/orders) | Orders are private, read (Browser) | Sample data from 2018 |
| [Eventbrite: embedded checkout](https://www.eventbrite.com/platform/docs/embedded-checkout) | Widget only (Browser) | Undated |
| [Eventbrite: webhooks](https://www.eventbrite.com/platform/docs/webhooks) | Events, retries (Browser) | Undated |
| [Eventbrite: rate limits](https://www.eventbrite.com/platform/docs/rate-limits) | 2,000 an hour (Browser) | Changed 2025-06 |
| [Eventbrite: changelog](https://www.eventbrite.com/platform/docs/changelog) | Rate-limit change date (Browser) | Latest entry 2025-06; older than 12 months |
| [Eventbrite: API terms](https://www.eventbrite.co.uk/support/articleredirect?anum=8483) | Competing-product clause | 2025-05-30; older than 12 months |
| [Eventbrite: organizer pricing](https://www.eventbrite.com/organizer/pricing/) | 3.7% + $1.79, 2.9% (Browser) | Undated |
| [Stripe: place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | Authorize then capture, windows | Undated |
