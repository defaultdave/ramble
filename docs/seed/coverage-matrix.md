# Seed coverage matrix

Generated from `src/lib/seed/coverage.ts`; do not edit by hand. Run `pnpm test -u src/lib/seed/coverage.test.ts` after changing the probes, then commit the result.

Every state in the signed-off Figma file ("Ramble Core Flow Wireframes", pages "Core flow (mobile)" and "States") maps to the seed rows that produce it. Each row below is a probe: a plain function that runs over the database after a seed and fails the seed run if the data is missing. The States page has ten states (S1 to S10); all ten are covered.

A state that needs a hold, a payment, or an order cannot be reached from seed rows alone. The seed supplies what that state stands on (a bookable session, a nearly full time, other dates to offer); the "To reach it" column says what a person or a later unit does with those rows. The seed does not fake the hold or the order itself.

## States

| State | Figma node | Name | Probes | To reach it |
|---|---|---|---|---|
| 01 | 44:10 | Home | `home-modules`, `picks-published`, `gift-guide`, `this-week`, `categories-eight` | Open the home page. **Gap:** The sponsor line on the gift module has no data model yet (Q-13). |
| 02 | 45:190 | Browse | `categories-eight`, `neighborhoods-six`, `cooking-page`, `page-copy`, `guide-only`, `many-results` | Open a category, neighborhood, Pick, gift guide, or search page. |
| 02b | 45:413 | Browse, filters open | `filter-variety` | Open All filters on a browse page. |
| 03 | 46:678 | Experience | `kayak-page`, `kayak-session-states`, `neighbors` | Open the kayak page. **Gap:** The seed writes no photo rows yet; the gallery shows its placeholder. |
| 03b | 46:897 | Guide-only page | `guide-only` | Open the sourdough entry. |
| 04 | 47:890 | Choose date and party | `kayak-session-states`, `kayak-full-day`, `bookable-party` | Tap the booking bar on the kayak page. |
| 04b | 47:1132 | Choose date, kids | `kids-booking` | Tap the booking bar on the kids wheel class. |
| 04c | 47:1350 | Choose date, 21+ | `twenty-one-plus` | Tap the booking bar on the natural wine class. |
| 05 | 48:1397 | Checkout | `kayak-page`, `waiver`, `legal-published`, `tax-treatments`, `twenty-one-plus`, `kids-booking` | Continue from the booking sheet to place a hold (U-014a). |
| 05b | 48:1517 | Checkout, gift | `gift-guide`, `gift-dates` | Switch to "Give as a gift" in the booking sheet. |
| 06 | 49:1548 | Confirmation | `kayak-page`, `neighbors` | Pay with the fake gateway. Needs orders (not in main yet). |
| 06b | 49:1688 | Confirmation, gift | `gift-guide` | Pay for a gift with the fake gateway. Needs gift orders (not in main yet). |
| 07 | 49:1784 | Manage booking | `kayak-other-dates`, `kayak-page` | Open the manage link from a confirmed order. Needs orders (not in main yet). |
| 08 | 49:1888 | Gift redemption | `gift-guide`, `gift-dates`, `waiver` | Open the link from a paid gift. Needs gift orders (not in main yet). |
| S1 | 53:7 | Loading | `cooking-page`, `many-results` | Slow the results read; the skeletons are the state. |
| S2 | 53:117 | Zero results | `kids-zero-results` | Search kids in Williamsburg for a weeknight. |
| S3 | 53:249 | Error with retry | `cooking-page` | Make the results read fail on the Cooking page. |
| S4 | 54:188 | Hold blocked | `kayak-full-day`, `bookable-party` | Place and abandon three holds within 15 minutes (PRD-17). |
| S5 | 54:287 | Sold out before the hold | `kayak-full-day` | Pick the kayak time with one space left for two guests while another guest takes it. |
| S6 | 55:300 | Hold expired | `bookable-party` | Place a hold and let the 10 minutes run out. |
| S7 | 55:360 | Sold out mid-checkout | `kayak-full-day`, `kayak-other-dates` | Let a hold lapse on the one-space time while another guest books it. |
| S8 | 55:414 | Card declined | `bookable-party` | Pay with the fake gateway set to decline. |
| S9 | 55:467 | Connection lost after Pay | `bookable-party` | Drop the connection after tapping Pay. |
| S10 | 55:516 | Paid after the hold lapsed | `kayak-other-dates` | Settle a payment after the hold has lapsed and the spaces have sold. |

## Other requirements from ADR 0008

| Requirement | Probes |
|---|---|
| Every experience status, and what a guest can see (PRD-12, PRD-13) | `hidden-statuses`, `pick-visibility` |
| Every cancellation tier (PRD-10) | `tiers-all` |
| Both weather policies (PRD-12) | `weather-both` |
| Every tax treatment (PRD-78) | `tax-treatments` |
| Hosts on allocations as well as hosts on Ramble (PRD-42) | `allocation-host` |
| Sessions with one space left and sold-out sessions (PRD-16, PRD-21) | `kayak-session-states` |

## What each probe checks

| Probe | The seed holds |
|---|---|
| `categories-eight` | The 8 categories each have at least one live experience. |
| `neighborhoods-six` | The 6 neighborhoods (Williamsburg, Carroll Gardens, Park Slope, Sunset Park, Tribeca, Lower East Side) each have at least one live experience. |
| `cooking-page` | Cooking has live experiences in Carroll Gardens and Sunset Park with upcoming sessions, and one guide-only entry (the category page in Figma 02, S1, and S3). |
| `many-results` | At least 24 live experiences, so a listing has a second page behind "Show more". The curated set is smaller; the scale fixture supplies the rest. *Needs the scale fixture (`--scale`).* |
| `filter-variety` | Live experiences differ on every filter: three or more price points, indoor and outdoor, all four age rules, and some with access notes. |
| `home-modules` | The home page has six enabled modules in order: hero_search, category_rail, picks, gift_guide, this_week, reassurance. The picks module shows the published Pick "rainy-day-sorted" and the gift_guide module the published gift guide; the hero and reassurance modules carry text. |
| `this-week` | At least four live experiences have a session in the next seven days (the "On this week" module). |
| `picks-published` | Three published Picks ("rainy-day-sorted", "slow-saturday-mornings", "golden-hour"), each listing at least three experiences a guest can see. |
| `pick-visibility` | A draft Pick ("date-night-downtown") exists and is never shown. A published Pick lists a guide-only entry, and another lists a paused experience that a guest must not see. |
| `gift-guide` | One published gift guide, "Give a Saturday, not a sweater", lists six experiences a guest can see, and gifts are switched on in settings. |
| `gift-dates` | Each gift guide entry has at least eight upcoming sessions, so a recipient has dates to pick from. The next eight weeks only; a rolling generator (U-068) extends the window toward the 12-month gift validity. |
| `page-copy` | Published copy (heading, description, intro, body) for all 8 categories and all 6 neighborhoods. |
| `kayak-page` | "sunset-kayak-on-the-hudson" (Hudson Paddle Club, Tribeca, Outdoors): live, outdoor, weather decided 3 hours before start, minimum age 12, a waiver, a meeting point, access notes, a flexible 24-hour cancellation tier, an adult price of $65, and a host with a description. |
| `kayak-session-states` | The kayak has upcoming sessions that are open, nearly full (1 to 3 spaces), and sold out. |
| `kayak-full-day` | One kayak Saturday has three times on the same date: one open, one with exactly one space left, one sold out (the calendar day in Figma 04, S4, S5, and S7). |
| `kayak-other-dates` | At least three kayak sessions more than a day away have room for two (the "other dates for 2 guests" list, and a booking that can still be cancelled with a full refund). |
| `bookable-party` | At least one session in the next 14 days has room for six, the most one guest can hold, so the booking flow and every payment state have something to book. |
| `guide-only` | "sourdough-mornings-at-rise-bakery" (Rise Bakery, Park Slope, Cooking) is guide-only with a link out, no sessions and no prices, and Cooking has two live experiences to show beside it. |
| `kids-booking` | "kids-wheel-class" (Wheelhouse Kids Studio, Williamsburg): ages 5 to 10, a free adult option that takes no space and a child price that does, with upcoming sessions. |
| `twenty-one-plus` | "natural-wine-explained" (Orchard Street Wine Room, Lower East Side) is live, 21 and over, taxable, on the moderate (48-hour) tier, with upcoming sessions. |
| `waiver` | The kayak requires a waiver, and the legal document it points at ("waiver-hudson-paddle-club") is a published version. |
| `legal-published` | Terms of service, privacy policy, and host agreement are published. |
| `tax-treatments` | Live experiences cover each tax treatment: taxable (wine, pottery, coffee), not taxable (kayak, walk), and unknown (pasta). The total shows a tax line only for taxable. |
| `neighbors` | The kayak shares Tribeca with a second live experience ("cast-iron-and-cobblestones"), for "More near Pier 26". |
| `kids-zero-results` | Kids in Williamsburg run only on weekends: browse for kids in Williamsburg on any weeknight in its date window returns nothing, and on a weekend returns the wheel class. A kids class in Park Slope and other Williamsburg experiences give the "nearby" and "one less filter" suggestions. |
| `hidden-statuses` | A draft, an in-review, and a paused experience exist and are the only ones a guest cannot see; live and guide-only both are. |
| `tiers-all` | Live experiences use each cancellation tier: flexible, moderate, and strict. |
| `weather-both` | Live outdoor experiences cover both weather policies: rain or shine (the walk) and decided before start (the kayak). |
| `allocation-host` | A live experience ("sunday-sound-bath", Low Tide Studio) sells an allocation set up by ops, so its sessions come from an allocation, not the host. |
