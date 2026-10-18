# R3: Payments for a marketplace where the host sells and Ramble collects

Researched 2026-10-18 for ADR 0003.

## Question

How should Ramble take card, Apple Pay and Google Pay payments, hold the money, release it to hosts, and refund it, when the client decided that the host is the seller and Ramble collects payment as the host's agent (Q-01 option c)? Recommend for the real job. Say what the demo simulates (C-09: no real money; test mode; hosts and payouts seeded or simulated).

Decided inputs this note takes as given (PRD "Decisions at sign-off"):

| Decision | What it fixes |
|---|---|
| Q-01 (c) | Host is the seller. Ramble collects as the host's agent, pending counsel (Q-16). |
| Q-03 | No buyer fee. Commission is 15% of the ticket price before tax. Card fees come out of Ramble's 15%. |
| Q-05 | Hosts are paid weekly after the session. |
| Q-06 | On a host or weather cancellation the host refunds in full and Ramble returns its commission. |
| Q-18 | The host, as seller, bears chargebacks. Ramble answers disputes with the host's evidence. (Our reading, to be confirmed in this ADR.) |

Sub-questions: charge type; `on_behalf_of` and "merchant of record"; connected account type; payout timing; refunding the commission; disputes; Radar and 3-D Secure; idempotency; Apple Pay and Google Pay in test mode; PCI scope; manual tax vs Stripe Tax; how long funds may sit before transfer (gifts); what that means for gift cards; alternatives; what the demo can show.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-17 | Fraud screening, and 3-D Secure where offered, on every booking. Velocity limits (6 spaces, 3 unpaid holds) are Ramble's own, not the provider's (R2). |
| PRD-18 | Card, Apple Pay and Google Pay. About 70% of mobile newsletter clicks are on iPhone. Depends on Q-01. |
| PRD-19 | One total with fee and tax itemized, and that total is the amount charged. The amount is computed on the server. |
| PRD-20 | A decline keeps the hold and lets the guest retry. The payment object must survive a failed attempt. |
| PRD-22 | Never charge twice, including on a flaky connection or a double tap. |
| PRD-26, PRD-28, PRD-51 | Guest cancel refunds per host tier. Host or Ramble cancel refunds every guest in full, without asking, same day, with emails inside 5 minutes. Staff can refund fully or partly. |
| PRD-33 | Gifts wait up to 12 months for redemption, are refunded to the buyer at 12 months, and the recipient can switch experiences. Ramble holds the money until redemption. |
| PRD-34 | Gift cards for a money amount, not tied to a host. Should, becomes Must if Q-13 requires. |
| PRD-47, PRD-56, PRD-57 | Weekly payout after the session, statements with gross/commission/fees/refunds, an export that reconciles to the provider, and a view of money held. |
| PRD-55 | A dispute record: who responded, evidence, outcome. Depends on Q-18. |
| PRD-59 | GMV and commission use the ticket price before tax and fees. The payment design must keep tax out of the commission base. |
| PRD-67 | The in-app browsers of Instagram and mail apps are supported, and Apple Pay works wherever Safari supports it. |
| PRD-70 | A newsletter spike sized to 12,500 visitors in 3 hours, with at least 99% of checkouts completing. |
| PRD-72 | Card data never touches Ramble's servers. PCI scope as small as possible. |
| PRD-74 | Refunds, cancellations and payout changes are logged with who and when. |
| PRD-78 | Each experience has a tax treatment. Taxable ones show a tax line at a configured rate. |
| RK-02, RK-03, RK-10 | Seller of record unresolved, gift cards vs the agent model, and chargebacks on a business that has never taken payments. |
| C-09 | Demo: payments in test mode, payouts simulated. |

House rules that bound the answer (from `~/.claude/standards/`): one service module per external service, wire types mapped inside it (ARCH-2, ARCH-3); the secret key only in a `server-only` module, read once and validated at boot, never `NEXT_PUBLIC_` (RSC-5, SET-18 to SET-20); every Server Action and Route Handler checks its caller and validates input, price re-derived on the server (SEC-1, SEC-2, SEC-3, SEC-5); retryable writes carry a stable idempotency key (FORM-8, decided per write endpoint in `stack-decisions.md`); expected failures such as declines are return values, unexpected ones throw (FORM-4, ARCH-9); mock the network, with failure cases and real API shapes (TEST-5, TEST-6).

## Options

### Facts that hold for every Stripe option

These are the findings the options share. Each option below cites them by name.

**F1. "Merchant of record" is not a Stripe term; "business of record" and "settlement merchant" are.**
- With a destination charge or a separate charge and no `on_behalf_of`, the platform is the business of record ([destination charges](https://docs.stripe.com/connect/destination-charges)).
- With `on_behalf_of`, the connected account is the settlement merchant: its statement descriptor shows, the fee structure of its country applies, and its `delay_days` payout setting applies ([charges](https://docs.stripe.com/connect/charges)). The connected account must hold a payments capability such as `card_payments` ([destination charges](https://docs.stripe.com/connect/destination-charges)).
- For destination charges and separate charges and transfers, with or without `on_behalf_of`, Stripe debits the platform for refunds, disputes and fees ([charges](https://docs.stripe.com/connect/charges)). Only direct charges move those to the connected account.
- So Q-01 (c) is a fact in Ramble's marketplace terms (host is the seller, Ramble collects as agent), not something a Stripe flag expresses. The Stripe-side question is only who Stripe and the card networks hold liable, and for any indirect charge that is Ramble.

**F2. Account configuration.** Stripe now steers new platforms to the Accounts v2 API with configurations, and calls Standard, Express and Custom "legacy account types" ([connected account types](https://docs.stripe.com/connect/accounts), [Accounts v2](https://docs.stripe.com/connect/accounts-v2)).
- For a marketplace on indirect charges, Stripe recommends `fees_collector` and `losses_collector` both set to `application` (the platform) ([account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)). That is the legacy Express shape.
- A host who only receives transfers needs the `recipient` configuration, whose `stripe_transfers` capability is the one indirect charges require. The `merchant` configuration (with `card_payments`) is needed only for `on_behalf_of` or direct charges ([Accounts v2](https://docs.stripe.com/connect/accounts-v2)).
- `dashboard` can be `express`, `full` or `none` ([account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)). Express hosts can see balance, payouts and earnings, and Ramble can switch off the refund and dispute features ([platform guide](https://docs.stripe.com/connect/interactive-platform-guide)).
- Stripe-hosted onboarding collects identity and bank details ([platform guide](https://docs.stripe.com/connect/interactive-platform-guide)). That suits PRD-39 white-glove setup: ops sits with the host on a call and the host completes Stripe's form.
- Payout settings for v2 accounts go through the Balance Settings API ([manage payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)). One destination-charges page still says v2 cannot manage payout settings ([destination charges](https://docs.stripe.com/connect/destination-charges)), so the docs disagree. Pin an API version and check at build time.
- Stripe advises new platforms to let Stripe carry negative-balance liability and only take it on with confidence in their own risk management ([risk best practices](https://docs.stripe.com/connect/risk-management/best-practices)). The Managed Risk product that carries it is available only with direct charges ([platform guide](https://docs.stripe.com/connect/interactive-platform-guide)). Under indirect charges Ramble carries it.

**F3. How long funds may sit.**
- Separate charges and transfers: the platform holds funds in its own balance until it transfers. A transfer tied to a charge with `source_transaction` waits until that charge's funds are available ([separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)). I found no documented cap on how old a charge may be for a `source_transaction` transfer. Not verified.
- Destination charges: the funds move to the connected account's pending balance at once ([charges](https://docs.stripe.com/connect/charges)). The platform can set the account's payout interval to `manual` and pay out later with the Payouts API ([manual payouts](https://docs.stripe.com/connect/manual-payouts)). Automatic delay is capped: `delay_days_override` accepts up to 31 ([manage payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)).
- Stripe's holding-period table lists 2 years for US businesses (90 days for most other countries). The manual-payouts page says manual-payout funds must be paid out within it ([manual payouts](https://docs.stripe.com/connect/manual-payouts)), and the "Holding funds" section of the balances page shows the same table next to both ways of holding funds, platform balance and connected-account balance ([account balances](https://docs.stripe.com/connect/account-balances)). That page does not say outright that the table covers the platform balance. Not verified.
- Stripe says it does not provide escrow, recommends holding only for a clear purpose and a commitment to release on an event (it names service completion), and tells platforms unsure about holding to ask their legal advisor ([manual payouts](https://docs.stripe.com/connect/manual-payouts), [account balances](https://docs.stripe.com/connect/account-balances)).
- Authorize-and-capture cannot carry a gift. Card authorizations last 7 days (5 days for some Visa merchant-initiated cases) ([place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)).
- Funds segregation (a way to wall off held funds from platform payouts, refunds and fees) exists for separate charges and transfers in the US, but it is private preview, needs the account manager, and excludes `on_behalf_of` and `automatic_payment_methods` ([funds segregation](https://docs.stripe.com/connect/funds-segregation)). Treat it as a hardening option, not a dependency.
- Card refund age: the refunds page states no time limit for card refunds ([refunds](https://docs.stripe.com/refunds)). A 180-day limit is documented for bank debits only. For a gift refunded 12 months after purchase this is unverified and must be confirmed with Stripe (open risk 1).

**F4. Refunds and the commission (Q-06).**
- Destination charge: a refund keeps the destination's money by default. `reverse_transfer=true` pulls it back. `refund_application_fee=true` returns Ramble's fee to the host, and it requires `reverse_transfer` ([destination charges](https://docs.stripe.com/connect/destination-charges)). Full refund reverses the whole transfer and the whole fee. If the host balance cannot cover the reversal, the refund request errors instead of going pending ([charges](https://docs.stripe.com/connect/charges)).
- Separate charges and transfers: a refund has no effect on transfers already made. The platform reconciles by reversing transfers or reducing later ones ([separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)). Before any transfer exists, a refund is a plain refund from the platform balance and the commission was never taken.
- Stripe does not return its own processing fee on a refund, nor the Connect fees ([refunds](https://docs.stripe.com/refunds), [pricing](https://stripe.com/pricing)). Under Q-03 and Q-06 as decided, that loss is Ramble's. See decision 2 under Recommendation and open risk 5.
- Transfer reversals work only if the connected account's available balance exceeds the reversal, or connected reserves are on ([separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)).

**F5. Disputes (Q-18, PRD-55).**
- Indirect charges: Stripe debits the platform for the disputed amount and the fee. The platform can try to recover by reversing the transfer. If the connected account goes negative, Stripe debits its bank account only if `debit_negative_balances` is on ([charges](https://docs.stripe.com/connect/charges), [account balances](https://docs.stripe.com/connect/account-balances)). US banks support auto debit ([account balances](https://docs.stripe.com/connect/account-balances)).
- So "the host bears chargebacks" is a contract term plus a recovery mechanism, not a Stripe allocation. Ramble fronts the money, and recovery depends on the host's balance, bank account and agreement. A negative connected balance held for 180 days is collected from the platform's reserves ([account balances](https://docs.stripe.com/connect/account-balances)).
- Dispute fee: $15 per dispute received; a further $15 countered fee is returned if the dispute is won ([pricing](https://stripe.com/pricing)).
- Timing: cardholders typically have 120 days, and for a future event or service the window usually opens on the event date, not the payment date ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work)). Stripe's UK article also cites a 540-day overall cap, sourced to a third party ([chargeback time limits, UK, updated 2026-03-16](https://stripe.com/resources/more/chargeback-time-limits-in-the-uk)). Deadline to respond: usually 7 to 21 days ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work)). Consequence: a gift bought now and redeemed in 12 months carries dispute exposure for well over a year.
- Stripe treats dispute activity above 0.75% as generally excessive ([risk best practices](https://docs.stripe.com/connect/risk-management/best-practices)). The PRD guardrail is 0.5% (G section).
- Liability shift: 3DS success and wallet cryptograms usually move fraud liability to the issuer but never guarantee it ([3DS](https://docs.stripe.com/payments/3d-secure/authentication-flow)).

**F6. Radar and 3-D Secure (PRD-17).**
- For charges made on the platform and transferred, Stripe applies only the platform's Radar configuration ([Radar with Connect](https://docs.stripe.com/connect/radar)). Ramble sets the rules, for every host.
- Radar screens cards and wallets backed by cards ([how Radar works](https://docs.stripe.com/radar/how-radar-works)). Plans: Lite, Standard, Plus, Pro. Custom rules, manual review and adaptive 3DS start at Plus. Standard, Plus and Pro charge per screened transaction. Radar account fees go to the platform ([how Radar works](https://docs.stripe.com/radar/how-radar-works)). Listed monthly prices: "starting at" $20 (Standard) and $44 (Plus) for Connect platforms ([Radar pricing](https://stripe.com/radar/pricing)). The per-transaction rate was not shown on the page. Unverified.
- 3DS triggers automatically when regulation or the issuer requires it. Wallets and off-session payments often do not support it. Setting `request_three_d_secure` to `any` overrides Radar's dynamic rules, and the API cannot turn 3DS off ([3DS](https://docs.stripe.com/payments/3d-secure/authentication-flow)). Stripe says 3DS is mandated by regulation in the EEA, UK, India, Japan and Australia and optional elsewhere ([3DS overview](https://docs.stripe.com/payments/3d-secure)), so for US cards it is a fraud control Ramble chooses.
- Test cards: `4000000000003220` always requires 3DS2; `4000000000009995` declines for insufficient funds; `4100000000000019` is always blocked by Radar; `4000000000000259` creates a fraud dispute ([3DS](https://docs.stripe.com/payments/3d-secure/authentication-flow), [testing](https://docs.stripe.com/testing)).

**F7. Idempotency (PRD-22).**
- Stripe accepts an `Idempotency-Key` on every POST, up to 255 characters. It saves the first result, including 500 errors, and replays it. Keys may be pruned after 24 hours. Reusing a key with different parameters is an error ([idempotent requests](https://docs.stripe.com/api/idempotent_requests)).
- A PaymentIntent that fails returns to `requires_payment_method` and can be retried. One that is `succeeded` cannot be charged again. Too many confirmations can cancel it ([lifecycle](https://docs.stripe.com/payments/paymentintents/lifecycle)).
- Webhooks can be delivered more than once and retry for up to 3 days in live mode ([webhooks](https://docs.stripe.com/webhooks)). The docs say to listen for `payment_intent.succeeded` rather than trust the browser ([destination charges](https://docs.stripe.com/connect/destination-charges)).
- Design, same for every option: (1) one order per hold, unique on hold ID; (2) `Idempotency-Key: pi:<holdId>` on the PaymentIntent create, safe because a 10-minute hold is far shorter than 24 hours; party-size changes use PaymentIntent update; (3) one PaymentIntent per hold, reused across declines and "try another card" (PRD-20), and cancelled when the hold lapses; (4) webhook route verifies the signature, then dedupes on `event.id` and on a unique PaymentIntent ID per order; (5) every refund and transfer call carries a key built from booking ID and sequence number (`refund:<bookingId>:<n>`, `transfer:<bookingId>:<run>`), plus a unique constraint in the ledger. A duplicate host transfer is the costliest failure here. R2's three layers (order, provider call, provider event) match this.

**F8. Apple Pay and Google Pay (PRD-18, PRD-67).**
- The Express Checkout Element shows Apple Pay, Google Pay, Link and others, and shares an Elements instance with the Payment Element ([Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)).
- Apple Pay with Elements needs every domain that shows the button registered, including subdomains and test domains. Stripe handles Apple merchant validation. The domain also needs HTTPS ([Apple Pay](https://docs.stripe.com/apple-pay), [domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration)).
- With destination charges and separate charges and transfers, register on the platform only. With direct charges, register on each connected account through the API ([domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration), [Apple Pay](https://docs.stripe.com/apple-pay)).
- Test mode: Apple Pay needs a real card in a real Apple Wallet and your test keys. Stripe returns a test token and does not charge the card. Stripe test cards cannot be added to Wallet ([Apple Pay](https://docs.stripe.com/apple-pay)). Google Pay uses Google's test card suite with Stripe test cards, after a real card is in the wallet ([Google Pay](https://docs.stripe.com/google-pay.md?platform=web)). For local work Stripe points to an HTTPS tunnel such as ngrok, so plain `localhost` is out. A domain registered in live mode is also registered in sandboxes ([domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration)).
- Each Vercel preview URL is a separate domain, so Apple Pay can only be demonstrated on registered, stable domains (my inference from the rule that every domain showing the button is registered; the docs name no wildcard).
- Apple Pay is documented as supported in iOS webviews, subject to Apple's usual eligibility rules ([Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)). I could not verify it inside Instagram's or the mail apps' in-app browsers (open risk 6).
- The Apple Pay sheet must open from a user gesture, with the sheet call near the top of the handler before slow async work ([Apple Pay](https://docs.stripe.com/apple-pay)). Create the PaymentIntent when the hold is created, not on the tap.

**F9. PCI scope (PRD-72).**
- Stripe is a PCI Level 1 service provider. Using Elements or Checkout keeps card data off Ramble's servers, and Stripe's guide places them in SAQ A ([PCI guide](https://stripe.com/guides/pci-compliance), [security guide](https://docs.stripe.com/security/guide)). Stripe.js must load from `js.stripe.com`, not a bundled copy ([destination charges](https://docs.stripe.com/connect/destination-charges)). Ramble may store card brand, last four and expiry ([security guide](https://docs.stripe.com/security/guide)).
- Since PCI DSS v4.0.1 (April 2025), a merchant page that embeds a payment iframe, as the Payment Element does, must meet an SAQ A criterion: the page is not susceptible to script attacks, shown by script controls like requirements 6.4.3 and 11.6.1 or by confirmation from the payment provider ([PCI SSC FAQ 1588](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants)). Redirects to a hosted page are excluded. Ramble's single-page checkout (D 2026-09-28) is the embedded case. It means a script inventory, a CSP on the checkout page (SEC-10, report-only first), and no marketing tags on that page. Stripe's PCI pages did not address this.

**F10. Tax (PRD-78, Q-12).**
- Manual treatment: Ramble stores taxable, not taxable or unknown per experience and a configured rate. Charge = ticket + tax. Commission = 15% of the ticket only. The tax passes through to the host's share, because the host is the seller who remits. Card fees also apply to the tax portion, which Ramble absorbs (about 38 cents on an average order at an illustrative 8.875%, my assumption of the rate; the real rate and map come from Q-12).
- Stripe Tax: calculates only where the account is registered, and returns zero otherwise ([Tax API](https://docs.stripe.com/tax/payment-intent/custom), [tax for platforms](https://docs.stripe.com/tax/tax-for-platforms)). When the connected account is liable, it needs that account's tax settings (head office, preset tax code) and registrations set through Stripe's APIs on the host's behalf before `automatic_tax` works ([tax for platforms](https://docs.stripe.com/tax/tax-for-platforms)). That means a state registration per host, which is Tom's and counsel's work (Q-12, Q-16), not a payment setting. Marketplace-facilitator rules may instead make the platform liable ([tax for marketplaces](https://docs.stripe.com/tax/tax-for-marketplaces)), another counsel question.
- Cost: Tax Basic API integration is 50 cents per transaction where registered, with 10 calculation calls included ([Stripe Tax pricing](https://stripe.com/tax/pricing)), about 2.2% of an average commission ($22.43). Sandbox tax calculations are capped at 1,000 a day and may not reflect current tax rules ([Tax API](https://docs.stripe.com/tax/payment-intent/custom)).
- Gap: Stripe Tax does not decide whether a class or a boat trip is taxable in New York; ops decides per experience either way.

**F11. Stripe fees (Q-03).** US cards: 2.9% + 30 cents; international cards +1.5%; refunds cost nothing to issue, but the original fees are not returned ([pricing](https://stripe.com/pricing)). Wallets are priced as cards on that page. Connect, when the platform sets pricing ("You handle pricing"): $2 per monthly active account (an account that was sent a payout that month), 0.25% + 25 cents per payout, and 0.25% of payout volume for "funds routing and platform management". Under "Stripe handles pricing" connected accounts pay the processing fees and the platform pays no account or payout fees ([Connect pricing](https://stripe.com/connect/pricing)). Q-03 (card fees inside Ramble's 15%) means "You handle pricing". The page says nothing about whether the 0.25% routing fee applies to indirect charges, and I count it as applying (unverified).

Illustration at list rates, before Radar and fixed fees (my arithmetic):

| Booking | Ticket | Commission 15% | Card fee | Payout fees (0.5%) | Ramble keeps | Share of ticket |
|---|---|---|---|---|---|---|
| $20, 1 guest | $20.00 | $3.00 | $0.88 | $0.09 | $2.03 | 10.1% |
| $65, 1 guest | $65.00 | $9.75 | $2.19 | $0.28 | $7.28 | 11.2% |
| Average ($65 x 2.3) | $149.50 | $22.43 | $4.64 | $0.64 | $17.15 | 11.5% |
| $180, 1 guest | $180.00 | $27.00 | $5.52 | $0.77 | $20.71 | 11.5% |

Fixed per host: $2 a month plus 25 cents a payout, about $3.08 a month for a weekly payee, so about $460 a month at 150 hosts. A fully refunded average booking costs Ramble $4.64 (the unreturned card fee) and earns nothing.

### Option A: Stripe Connect, separate charges and transfers, platform as business of record (recommended)

**How it works.**
1. Hold created (R2). The server creates a PaymentIntent on Ramble's platform account for ticket plus tax, with `transfer_group` set to the booking, metadata for hold, booking and host, and the idempotency key from F7. No `on_behalf_of`, no `transfer_data`.
2. The guest pays with the Payment Element or Express Checkout. `payment_intent.succeeded` creates the booking.
3. A release event (session ended and a day passed, picked up by the weekly run, Q-05) creates a Transfer to the host's connected account for ticket minus 15% plus tax, with `source_transaction` set to the charge. Ramble keeps the difference as its commission. The host's Stripe payouts run on their normal schedule.
4. Cancel before release (host, weather or guest inside a refund tier): refund from the platform balance. No transfer exists, so nothing is reversed and the commission was never taken. That satisfies Q-06 with one API call per booking.
5. Gift: charge at purchase, store the gift record (R2), make no transfer. At redemption the booking is funded by that charge and released as in step 3. A switch to another host's experience needs no reversal, because no host has been credited.
6. Refund or dispute after release: refund or dispute debits the platform; Ramble reverses the transfer (F4, F5) and has `debit_negative_balances` on.
7. Hosts: v2 accounts with `recipient` configuration, `dashboard: express`, both responsibilities `application`, Stripe-hosted onboarding (F2).

**Fit to the PRD.**
- Serves PRD-33 (one mechanism for bookings and gifts, host chosen at redemption), PRD-28 (a mass same-day refund draws on Ramble's held balance and cannot error on a host's balance; if available balance runs short, card refunds wait as pending rather than fail ([refunds](https://docs.stripe.com/refunds))), PRD-47 (the release job is the payout rule), PRD-57 (the money-held view is the sum of unreleased payments and unredeemed gifts, checkable against the platform balance), PRD-72, PRD-17 and PRD-18 (F6, F8, platform-level Radar and one domain registration), PRD-22 (F7).
- Strains PRD-56: no Application Fee objects exist, so commission and the release amount are Ramble's own ledger rows reconciled to balance transactions, transfers and payouts (R2 holds the append-only money rows). Strains PRD-55 and Q-18: Ramble fronts every dispute, and recovery after release depends on the host's balance and agreement.
- PRD-34 is not served by any Stripe charge type (see the gifts section below).

**Cost.** Stripe fees as in F11, about 11.5% of an average ticket after card and payout fees. Radar from $20 a month plus per-transaction fees (unverified). No tax product fee at launch (F10). Engineering: the ledger and the release job are Ramble's code, in `lib/` as plain functions (ARCH-1, ARCH-4) with Stripe behind one service module.

**Risks.**
- Ramble holds host money in its own Stripe balance, weeks for bookings and up to 12 months for gifts. Stripe offers no escrow and tells platforms to ask counsel (F3). Whether the agent-of-payee position covers this is Q-16's job. Stripe's own EU guide frames Connect as keeping platforms out of possession of funds, so Option A sits closer to the line than Option B ([Stripe PSD2 guide, EU, updated 2021-09-14](https://stripe.com/guides/how-psd2-impacts-marketplaces-and-platforms)). I found no US-specific Stripe analysis. Unverified.
- Platform payouts must not sweep held funds. Stripe warns that automatic platform payouts can interfere with transfers that lack a `source_transaction` ([separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)). Run the platform's own payouts manually and move only Ramble's earned commission. Funds segregation (F3) is the vendor-side fix.
- The 2-year ceiling, the unknown card-refund age limit and the dispute window all bite on gifts (F3, F5).
- Stripe's restricted-business list marks "third-party agents" (payment facilitation, including receiving settlement proceeds for goods or services you did not provide on behalf of third-party sellers) as Restricted, meaning extra due diligence and approval not guaranteed ([restricted businesses](https://stripe.com/legal/restricted-businesses)). The page does not list marketplaces on their own. Say plainly in the Connect application that Ramble is a marketplace on Connect.

**Evidence.** F1 to F11 and the sources they cite.

### Option B: Stripe Connect, destination charges with an application fee, connected accounts on manual payouts

**How it works.**
1. PaymentIntent on the platform with `transfer_data[destination]` set to the host and `application_fee_amount` set to 15% of the ticket. The whole charge moves to the host's pending balance at once, and the fee comes back to the platform ([destination charges](https://docs.stripe.com/connect/destination-charges)).
2. Host accounts are set to manual payouts. A weekly job creates a Payout on each host's account for sessions that have ended ([manual payouts](https://docs.stripe.com/connect/manual-payouts)). The host sees a balance in the Express Dashboard that is not yet paid out.
3. Cancel: refund with `reverse_transfer=true` and `refund_application_fee=true`. That is the documented form of Q-06 (F4). It errors if the host's balance cannot cover the reversal.
4. Dispute: debits the platform; Ramble reverses the transfer from the host's balance, which is still full of the money while it waits for payout (F5).

**Variant B2, with `on_behalf_of`.** The host becomes settlement merchant: their descriptor on the guest's statement, `delay_days` governing payout timing (up to 31 days), and every host needs the `card_payments` capability ([destination charges](https://docs.stripe.com/connect/destination-charges), [manage payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)). For a US-only marketplace the gains are the descriptor and optics. The costs are heavier host onboarding and a card statement that may show a name the guest does not associate with Ramble, which invites "unrecognized transaction" disputes. Ramble stays liable for refunds and disputes either way (F1).

**Fit to the PRD.**
- Serves Q-06 (one-to-one with documented parameters), PRD-56 (Application Fee objects and a Dashboard report), PRD-47 (weekly payout job), and the "agent, not holder" reading of Q-01 (c): the money is in the host's own Stripe balance, not Ramble's (my reading, for counsel).
- Strains PRD-33: the money is already committed to one host. Switching experiences means reversing one transfer and making another. A gift older than 12 months must be unwound from a host who may have left. Gifts would need a second, platform-held path, which is Option A for gifts anyway.
- Strains PRD-28: each refund in a mass cancellation is a reversal that can fail on that host's balance, and fails exactly when a host's balance is low.
- Strains PRD-34 the same way as Option A (see the gifts section below).
- Holding limits (F3): manual payouts must be paid within 2 years (US), automatic delay at most 31 days. Fine for bookings, not for gifts.

**Cost.** Same Stripe fees as Option A, plus the same account and payout fees.

**Risks.** Two code paths (card bookings and gifts). Hosts see balances they cannot withdraw, which feeds RK-09 (payout-after-session shock). Everything in F5 still lands on Ramble first.

### Option C: Stripe Connect, direct charges on Standard accounts

**How it works.** The charge is created on the host's own Stripe account with Ramble's `application_fee_amount`. The host is the Stripe-level business of record. Refunds, disputes and (by configuration) fees come out of the host's balance ([charges](https://docs.stripe.com/connect/charges)). Standard accounts support only direct charges and give hosts the full Stripe Dashboard ([connected account types](https://docs.stripe.com/connect/accounts)).

**Fit to the PRD.**
- Serves Q-01 (c) and Q-18 at the Stripe level better than any other option: the host is the merchant, the host bears chargebacks, Stripe can carry losses (Managed Risk) ([platform guide](https://docs.stripe.com/connect/interactive-platform-guide)).
- Strains PRD-33 and PRD-34 hardest: the money goes to the host at purchase, so Ramble cannot hold a gift or a gift card at all.
- Strains PRD-17: the connected account's Radar rules and plan apply to direct charges ([Radar with Connect](https://docs.stripe.com/connect/radar)), so Ramble does not control screening.
- Strains PRD-18 setup: Apple Pay and Google Pay domains must be registered on each host's account by API ([Apple Pay](https://docs.stripe.com/apple-pay)).
- Strains PRD-39: every host needs a full Stripe account and Dashboard. Stripe positions Standard for connected accounts that are already experienced online businesses, and the PRD's hosts are small operators with a 15-minute weekly admin budget. Payout timing is possible only through platform controls ([connected account types](https://docs.stripe.com/connect/accounts)).
- PRD-55: Ramble would answer disputes by acting as each connected account.

**Cost.** Fees fall on the host or the platform by configuration. Card fees inside Ramble's 15% (Q-03) means choosing the platform-pays configuration, where the application fee must cover Stripe's fee too ([account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)).

**Risks.** One session per checkout (PRD-14) suits direct charges, which involve a single connected account per payment. Gifts and same-day refunds spread across many host accounts are the hard part. Keep as the fallback if counsel says Ramble may not touch funds at all.

### Option D: Fake gateway only

**How it works.** A payments service module in `lib/` implements Ramble's own interface (create payment, confirm, refund, transfer, event). Its adapter simulates charges, declines, 3DS, refunds, transfers and webhooks against the app's data store, with fixed test card numbers and signed fake events sent to the real webhook route.

**Fit to the PRD.**
- Serves PRD-22 and PRD-20 (deterministic double-submit and decline tests in CI), PRD-70 (Stripe discourages load-testing against a sandbox, because limits are 25 requests a second there against 100 in live mode and the payment gateway is mocked, and recommends a configurable mock with simulated latency ([rate limits](https://docs.stripe.com/rate-limits))), C-09, and TEST-5 and TEST-6 (mocks with failure cases and the real API's shape).
- Strains PRD-17, PRD-18 and PRD-72 as evidence: no Radar, no real 3DS, no real Apple Pay sheet, no real hosted-field iframe. A fake Apple Pay button demonstrates nothing.
- Does not test the Connect money flow, which is the least certain part of the design (F3 to F5).

**Cost.** Zero fees, no Stripe account. Engineering effort is small and mostly reusable, because the same interface fronts Option A.

**Risks.** Weakest evidence for a method meant to be proven: every hard part would be a simulation of an assumption. Use it as a test double beside a real adapter (see Recommendation), not instead of one.

### Option E: another marketplace provider

**PayPal Commerce Platform (multiparty).**
- Delayed disbursement holds funds and then pays the seller automatically after 28 days. It requires being an approved partner and sellers onboarded with the `DELAY_FUNDS_DISBURSEMENT` feature. Platform fees need the `PARTNER_FEE` feature ([delay disbursement, updated 2026-10-14](https://developer.paypal.com/docs/multiparty/checkout/delayed-disbursement/)).
- Apple Pay and Google Pay are available to onboarded sellers through the Partner Referral API ([Apple Pay](https://developer.paypal.com/docs/multiparty/checkout/apm/apple-pay/), [Google Pay](https://developer.paypal.com/docs/multiparty/checkout/apm/google-pay/)).
- Fit: serves PRD-18 and a sandbox demo, but a 28-day cap cannot hold a 12-month gift, and the approved-partner gate is a schedule risk for December 1. I did not find a fee schedule. Unverified.

**Adyen for Platforms.**
- Split payments, balance accounts, settlement models and a settlement-delay setting exist ([Adyen split payments](https://docs.adyen.com/platforms/quickstart-guide/payments)). I found no self-serve test path or minimums in what I read. Treated as sales-led and aimed at larger volumes. Unverified.

As far as I could tell, neither beats Stripe for a client with no engineers, a December 1 date and a demo that must run without a sales call: PayPal gates the delayed-disbursement feature behind partner approval, and Adyen looked sales-led. Neither was costed.

### Gifts and gift cards under the agent model

**PRD-33 (gift of a specific experience).**
- Funds must wait up to 12 months, be refundable to the buyer, and be redirectable to another host. Only a platform-held charge fits (Option A; Option B needs a second path). Authorize-and-capture lasts 7 days, so it cannot carry a gift (F3).
- Under Q-01 (c) this means Ramble holds the money as the host's agent for up to 12 months. PRD-33 already says counsel must confirm that.
- Three Stripe limits to design around: the US holding period of 2 years (F3), the unverified card-refund age limit (F3), and dispute windows that start at the redemption date (F5). If a card refund is impossible at 12 months, the fallback is a manual bank payout to the buyer, which has its own identity and fraud cost.

**PRD-34 (gift cards).**
- Stripe does not hold stored value itself. Its gift-card payment method is a private preview that fronts one third-party provider (SVS), whose cards settle off Stripe, mainly for Terminal, in the US, with no refunds or disputes ([gift cards](https://docs.stripe.com/payments/gift-cards)). It needs Ramble to already have an agreement with that provider.
- Stripe's restricted-business list marks selling gift cards and other stored value as Restricted, with extra due diligence and no guaranteed approval ([restricted businesses](https://stripe.com/legal/restricted-businesses)).
- A gift card is therefore a Ramble-built ledger liability with Ramble as its seller, whatever Q-01 says, which matches the PRD's note that gift cards fit option (a). The card sale itself can be taken with Option A's charge, but the liability outlives Stripe's 2-year holding period and must be funded from Ramble's own bank account.
- New York's gift certificate statute defines a gift certificate as a prepaid record usable for goods or services, sets a minimum expiry of the later of nine years from issue or last load, and leaves unclaimed balances subject to the abandoned property law ([NY GBL 396-i](https://www.nysenate.gov/legislation/laws/GBS/396-I)). A search found a 2021 bill that raised an earlier five-year minimum to nine, and I could not confirm the in-force text or whether a gift of one specific experience counts ([NY Senate bill S3467](https://www.nysenate.gov/legislation/bills/2021/s3467)). Federal rules (12 CFR 1005.20) were not checked. If either applies to PRD-33 or PRD-34, the 12-month validity and refund design in PRD-33 is wrong, and the money could not sit in a Stripe balance at all. This is a counsel question (Q-16), raised here because it decides the payments design.

## Comparison table

| | A. Connect SCT (rec.) | B. Connect destination | C. Connect direct, Standard | D. Fake gateway | E. PayPal / Adyen |
|---|---|---|---|---|---|
| Stripe business of record | Ramble (no `on_behalf_of`) | Ramble; host if B2 | Host | n/a | Provider-specific |
| Who Stripe debits (refund, dispute, fee) | Ramble | Ramble | Host | n/a | Not checked |
| Weekly pay after session (Q-05) | Transfer on release | Manual payout on host account | Platform controls only | Simulated | PayPal: 28-day max hold |
| Q-06 host cancel | Plain refund before transfer | `reverse_transfer` + `refund_application_fee`, errors if host balance short | Native on host account | Simulated | Not checked |
| Gift held 12 months, switch host (PRD-33) | Yes, platform balance | Needs second path | No | Simulated | PayPal no (28 days) |
| Gift cards (PRD-34) | No (Ramble ledger) | No | No | n/a | Not checked |
| Dispute recovery (Q-18) | Ramble fronts, reverses transfer | Same, host balance still holds money | Host bears | Simulated | Not checked |
| Radar and 3DS control (PRD-17) | Ramble sets rules | Ramble sets rules | Host's rules | None | Not checked |
| Apple/Google Pay domains (PRD-18) | Platform only | Platform only | Each host | Not real | Seller onboarding |
| Reconciliation (PRD-56) | Own ledger | Application Fee objects | Per-host accounts | n/a | Not checked |
| Host onboarding (PRD-39) | Stripe-hosted, Express | Stripe-hosted, Express | Full Stripe account | None | Partner onboarding |
| Ramble keeps on avg booking | $17.15 (11.5%) | $17.15 (11.5%) | Config-dependent | n/a | Not costed |
| Code paths | One | Two (bookings, gifts) | Two plus per-host ops | One | Not scoped |
| Demo in test mode | Yes, real Stripe sandbox | Yes | Yes | Yes, no real wallets | Sandbox exists |
| Counsel risk (Q-16), my reading | Ramble holds funds | Lower: funds sit in host balance | Lowest | None | Not checked |

## Recommendation

Option A: Stripe Connect on separate charges and transfers, with Ramble's platform account as business of record, Payment Element plus Express Checkout Element for the guest, and a fake gateway behind the same interface for tests and local development. The demo runs on a Stripe sandbox, because the Connect money flow, the wallets and the webhooks are the parts worth proving.

Why A over B: it is the only option that handles bookings and gifts with one mechanism (PRD-33), makes mass cancellation refunds independent of host balances (PRD-28, Q-06), and puts the "host is paid after the session" rule in code Ramble controls (Q-05). B's main advantage is a lighter counsel position (funds in the host's balance) and Application Fee reporting. If counsel makes that decisive, switch (see below).

Design choices the ADR should record:

1. **Charge on the platform, no `on_behalf_of`.** Ramble is Stripe's business of record, so guests see a Ramble descriptor on their statement. Q-01 (c) lives in the marketplace terms and host agreement (F1).
2. **Host accounts:** v2 `recipient` configuration, `dashboard: express`, `fees_collector` and `losses_collector` both `application`, Stripe-hosted onboarding during white-glove calls, `debit_negative_balances` on (F2, F5). Pin the API version.
3. **Release rule:** a weekly job transfers ticket minus 15% plus tax for sessions ended at least 24 hours ago, using `source_transaction` and an idempotency key per booking. Keep the platform's own payouts manual and move only earned commission (F3, Risks).
4. **Cancellations:** refund first and in full from the platform balance when no transfer exists. After release, refund and reverse the transfer. Commission on partially refunded bookings is undefined today (decision 3 below, open risk 14).
5. **Fraud:** Radar Standard from day one, dynamic 3DS (leave `request_three_d_secure` at its default so Radar's rules apply), review Radar Plus after the first month of dispute data. Velocity limits stay in R2 (F6).
6. **Idempotency:** the five layers in F7, with FORM-8 recorded as "every write that calls Stripe carries a key derived from our own record ID".
7. **Tax:** manual per-experience treatment and a configured rate at launch (PRD-78). Revisit Stripe Tax only after Q-12 and counsel say who registers (F10).
8. **PCI:** SAQ A, plus the script-control criterion for the embedded Payment Element (F9). Put a report-only CSP on the checkout page (SEC-10) and keep it free of third-party tags.
9. **Gift cards (PRD-34):** do not build them on Stripe. If Q-13 requires them, take Q-01 option (a) for gift cards only, or a licensed third-party gift-card vendor, and settle the NY and federal questions first (Gifts section, open risk 2).
10. **Code shape:** one `lib/payments/` service module with a Stripe adapter and a fake adapter, wire types mapped inside (ARCH-2, ARCH-3), secrets in a `server-only` module (RSC-5, SET-18 to SET-20), webhook route as a thin shell (ARCH-4, SEC-2). The fake adapter is the CI default and the load-test double.

What the demo can show with a Stripe sandbox (Dave creates the Stripe account and sandbox; this research did not):

| Real in the sandbox | Simulated or limited |
|---|---|
| Payment Element and Express Checkout, with test cards for success, decline (`4000000000009995`), 3DS (`4000000000003220`), Radar blocks (`4100000000000019`) ([testing](https://docs.stripe.com/testing)) | Apple Pay needs a real Apple device with a real card in Wallet and a registered HTTPS domain, and is not charged ([Apple Pay](https://docs.stripe.com/apple-pay)). Google Pay uses Google's test card suite. Local work needs an HTTPS tunnel, and unregistered preview URLs will not show the wallets. |
| PaymentIntents, double-submit and retry behavior, webhook signature checks and dedupe | Webhooks need the Stripe CLI or a deployed endpoint. |
| Connected host accounts created through the API with Stripe's test verification values (for example DOB `1901-01-01`, SSN `000000000`, address `address_full_match`) and a test bank (routing `110000000`, account `000123456789`) ([Connect testing](https://docs.stripe.com/connect/testing)) | Real KYC, real banks and real payout timing. The weekly release is a job run on demand with a date argument. |
| Transfers with `source_transaction`, transfer reversals, refunds, partial refunds | `4000000000000077` puts funds straight into available balance for transfers that do not use `source_transaction` ([testing](https://docs.stripe.com/testing)). |
| Disputes from test cards (`4000000000000259` fraud, `4000000000002685` product not received), with winning or losing evidence ([testing](https://docs.stripe.com/testing)) | Real dispute timelines (7 to 21 days to respond, 2 to 3 months to decide). |
| Radar rules and 3DS mock pages | Radar's real model behavior and real issuer 3DS. |
| Manual tax lines | Tax registrations and Stripe Tax accuracy (sandbox results may be stale). |
| Nothing | Holding a real gift for 12 months, card-refund age limits, Stripe's compliance review of the platform. |

Decisions for Dave at the P2 sitting:
1. Adopt Option A (SCT) over B (destination), conditional on counsel not ruling out Ramble holding funds.
2. Who absorbs the unreturned card fee on a host or weather cancellation: Ramble (as decided in Q-03 and Q-06) or the host (a host-agreement term)?
3. Commission on a partially refunded booking: on the retained amount or the original?
4. Gift cards: build on a Ramble ledger, use option (a) for them, use a vendor, or cut PRD-34 if Q-13 allows.
5. Demo runs on a Stripe sandbox (needs a Stripe account) with the fake adapter for tests.

## What would change the call

- **Counsel (Q-16) says Ramble cannot hold host money**, or Stripe confirms a hold limit shorter than 12 months for the platform balance: move bookings to Option B and redesign gifts (host-issued vouchers, or Ramble as seller of gifts under Q-01 option a). If counsel also rejects Ramble touching funds at all, Option C is the fallback, and gifts and gift cards fall away.
- **Q-13 requires gift cards:** Option A stays for bookings. Gift cards become a separate decision (Ramble as seller, or a vendor), and may force Q-01 (a) for that product only.
- **NY or federal gift law applies to PRD-33:** the 12-month validity and 12-month refund change, which changes how long funds sit and likely moves gift liability out of Stripe entirely.
- **Card refunds fail after a set age** (confirm with Stripe): shorten the gift refund path or pay buyers by bank transfer.
- **Stripe declines or restricts the Connect application** (restricted-business entries): PayPal or Adyen come back on the table, with a longer lead time.
- **Express Dashboard plus platform liability turns out to be unavailable** in the pinned API version: use controller properties on v1 accounts or `dashboard: none` with embedded components.
- **Dispute rate above 0.5%:** add Radar Plus rules or lengthen the release delay (for example to two weeks after the session). The Q-05 schedule would then need Marcus and Tom again.
- **Scale:** at the PRD's forecast of 1,800 bookings a month (about $40k commission), the Connect fixed fees are about 1% of commission. Ask Stripe about the revenue share and custom pricing the Connect page mentions.
- **If Dave wants no Stripe dependency for the demo:** Option D alone, accepting that wallets, Radar and Connect would be shown as simulations.

## Open risks

1. **Card refund age limit unknown.** Stripe's refund docs state none for cards (bank debits have 180 days). A gift refunded at 12 months could fail. Ask Stripe support before PRD-33 is built. Owner: Dave to ask, ADR 0003.
2. **Gift law.** NY GBL 396-i (as published: nine-year minimum expiry) and federal 12 CFR 1005.20 may cover PRD-33 and PRD-34 and conflict with 12-month validity and refund. Owner: Tom with counsel (Q-16).
3. **Money held by Ramble.** Counsel position on agent-of-payee for platform-held funds in New York is unverified, as is whether Stripe's 2-year limit covers the platform balance. Owner: Tom with counsel (Q-01, Q-16, RK-02, RK-03).
4. **Stripe's Connect review.** Restricted-business entries (third-party agents, stored value) may apply. Approval time is not documented and December 1 is six weeks away (RK-01). Start the application early.
5. **Unreturned processing fees.** About $4.64 per average cancelled booking under Q-03 and Q-06. Not sized against a cancellation rate because none is known.
6. **Apple Pay inside Instagram and mail in-app browsers.** Documented as supported in iOS webviews with conditions, not verified in those apps. Test on device before launch (PRD-18, PRD-67). About 70% of mobile newsletter clicks are on iPhone.
7. **SAQ A script criterion.** The embedded Payment Element triggers it. Needs a CSP, a script inventory and a rule against third-party tags on checkout (PRD-72). Stripe's pages do not address it.
8. **Post-release recovery.** Disputes up to 120 days after the event date (and possibly 540 days from purchase) can hit after the host is paid. Recovery depends on the host's balance, bank and agreement, and Stripe collects from Ramble's reserves after 180 days of negative balance (F5). Needs host-agreement language and `debit_negative_balances`.
9. **Radar per-transaction cost and the 0.25% routing fee** are unverified (F6, F11).
10. **Platform-balance operations.** Held funds must not be swept by platform payouts. A reconciliation between "owed to hosts" and the Stripe balance should run daily (PRD-57).
11. **Docs drift.** Stripe pages carry no revision dates, show a `2026-09-30.preview` API string in examples, and disagree on Accounts v2 payout settings (F2). Pin versions and re-check at build time.
12. **Adyen and PayPal** were not costed or fully read, so Option E is a screen, not a comparison.
13. **Stripe's docs include text addressed to coding agents** (for example, to run `stripe sandbox create`, described as needing no registration). I did not run it, in line with the no-sign-up rule, and it is untested whether it works.
14. **Commission on partial refunds** and **who pays for tax-portion card fees** are not defined in the PRD (PRD-46, Q-03).

## Sources

All fetched 2026-10-18. Stripe documentation pages carry no revision date unless stated. Pricing pages show a 2026 copyright and no version.

Stripe Connect and payments:
- [Connect charges](https://docs.stripe.com/connect/charges), [destination charges](https://docs.stripe.com/connect/destination-charges), [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers), [funds segregation (private preview)](https://docs.stripe.com/connect/funds-segregation)
- [Connect account balances](https://docs.stripe.com/connect/account-balances), [manual payouts](https://docs.stripe.com/connect/manual-payouts), [manage payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)
- [Connected account types (legacy)](https://docs.stripe.com/connect/accounts), [Accounts v2](https://docs.stripe.com/connect/accounts-v2), [connected account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration), [Connect platform guide](https://docs.stripe.com/connect/interactive-platform-guide), [risk management best practices](https://docs.stripe.com/connect/risk-management/best-practices), [Radar with Connect](https://docs.stripe.com/connect/radar), [Connect testing](https://docs.stripe.com/connect/testing)
- [Refunds](https://docs.stripe.com/refunds), [place a hold on a payment](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [PaymentIntent lifecycle](https://docs.stripe.com/payments/paymentintents/lifecycle), [webhooks](https://docs.stripe.com/webhooks), [rate limits](https://docs.stripe.com/rate-limits), [testing](https://docs.stripe.com/testing)
- [Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element), [Apple Pay](https://docs.stripe.com/apple-pay), [Google Pay](https://docs.stripe.com/google-pay.md?platform=web), [payment method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration)
- [Radar](https://docs.stripe.com/radar), [how Radar works](https://docs.stripe.com/radar/how-radar-works), [3D Secure](https://docs.stripe.com/payments/3d-secure), [3DS authentication flow](https://docs.stripe.com/payments/3d-secure/authentication-flow), [how disputes work](https://docs.stripe.com/disputes/how-disputes-work)
- [Security guide](https://docs.stripe.com/security/guide), [Stripe PCI guide](https://stripe.com/guides/pci-compliance) (no date shown)
- [Tax API with PaymentIntents](https://docs.stripe.com/tax/payment-intent/custom), [Stripe Tax with Connect](https://docs.stripe.com/tax/connect), [tax for platforms](https://docs.stripe.com/tax/tax-for-platforms), [tax for marketplaces](https://docs.stripe.com/tax/tax-for-marketplaces)
- [Gift card payments (private preview)](https://docs.stripe.com/payments/gift-cards), [restricted businesses](https://stripe.com/legal/restricted-businesses) (no date shown)
- Pricing: [standard pricing](https://stripe.com/pricing), [Connect pricing](https://stripe.com/connect/pricing), [Radar pricing](https://stripe.com/radar/pricing), [Stripe Tax pricing](https://stripe.com/tax/pricing)

Older or secondary (flagged):
- [Stripe, How PSD2 impacts marketplaces and platforms](https://stripe.com/guides/how-psd2-impacts-marketplaces-and-platforms): EU only, updated 2021-09-14, more than 12 months old.
- [Stripe, Chargeback time limits in the UK](https://stripe.com/resources/more/chargeback-time-limits-in-the-uk): UK article, updated 2026-03-16; the 540-day figure is sourced to a third party. Card network rulebooks were not read.
- [PCI SSC FAQ 1588 on SAQ A](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants): primary source, read through the fetch tool's summary; the SAQ A document itself was not read.
- [NY GBL 396-i](https://www.nysenate.gov/legislation/laws/GBS/396-I) and [2021 bill S3467](https://www.nysenate.gov/legislation/bills/2021/s3467): the statute page was summarized by the fetch tool; the in-force text and the bill's outcome were not confirmed.
- [PayPal delay disbursement](https://developer.paypal.com/docs/multiparty/checkout/delayed-disbursement/) (updated 2026-10-14), [PayPal Apple Pay](https://developer.paypal.com/docs/multiparty/checkout/apm/apple-pay/), [PayPal Google Pay](https://developer.paypal.com/docs/multiparty/checkout/apm/google-pay/), [Adyen platforms payments](https://docs.adyen.com/platforms/quickstart-guide/payments): overview pages only.

PRD and standards read: `docs/product/PRD.md` (v1.0, 2026-10-18), `docs/plan/BUILD-PLAN.md`, `~/.claude/standards/react-nextjs.md`, `architecture.md`, `stack-decisions.md`.
