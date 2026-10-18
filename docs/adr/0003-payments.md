# ADR 0003: Payments

- **Status:** Accepted 2026-10-18 (Dave), with one change: the demo runs on the fake gateway only, with no Stripe account. Wallets, Radar, 3-D Secure, and Connect transfers are simulated in the demo; the design stays Option A for the real job. Answers: Ramble absorbs the unreturned card fee on host and weather cancellations; commission on a partially refunded booking is 15% of the amount the host keeps; working assumption that the sponsor does not need gift cards (Q-13), so PRD-34 goes first in the cut order.
- **Date:** 2026-10-18
- **Question:** R3 in `docs/plan/BUILD-PLAN.md`
- **Research:** [research/r3-payments.md](research/r3-payments.md)
- **Depends on:** ADR 0002 (ledger, holds, idempotency), Q-16 (counsel)
- **Settles stack decisions:** FORM-8 (every write that calls the payment provider carries a key derived from Ramble's own record ID); SEC-10 on the checkout page

## Context

The client decided (PRD sign-off): the host is the seller and Ramble collects payment as the host's agent (Q-01 c); hosts are paid weekly after the session (Q-05); on a host or weather cancellation the host refunds in full and Ramble returns its commission (Q-06); no buyer fee, and the 15% commission is on the ticket price before tax, with card fees inside Ramble's 15% (Q-03). Gifts can wait up to 12 months (PRD-33). The demo moves no real money (C-09).

Two facts reframe the question. "Merchant of record" is not a Stripe term: for any charge Ramble creates on its own platform account, Stripe holds Ramble liable for refunds, disputes, and fees, whatever the marketplace terms say. So Q-01 (c) lives in Ramble's terms and host agreement, not in a Stripe setting. And Stripe can't hold stored value for gift cards (PRD-34): its gift-card method is a private preview fronting one third-party provider, and selling stored value is a restricted business.

## Driving requirements

| ID | Why it matters here |
|---|---|
| PRD-18, PRD-67 | Card, Apple Pay, Google Pay, including on iPhone and in in-app browsers |
| PRD-17, PRD-20, PRD-22 | Fraud screening and 3-D Secure; payment failure; no double charge |
| PRD-26, PRD-28, PRD-51 | Guest cancellations, mass host cancellations, partial refunds |
| PRD-33, PRD-34 | Gifts held up to 12 months; gift cards |
| PRD-47, PRD-55, PRD-56, PRD-57 | Payouts after the session, disputes, the finance export, money held |
| PRD-72, PRD-78 | Card data never on Ramble's servers; tax lines |

## Options

| | A. Stripe Connect, separate charges and transfers | B. Stripe Connect, destination charges with an application fee | C. Stripe Connect, direct charges on hosts' own accounts | D. Fake gateway only |
|---|---|---|---|---|
| Who Stripe holds liable | Ramble | Ramble | Host | n/a |
| Weekly pay after the session (Q-05) | Ramble transfers on release | Manual payouts on each host account | Hosts control their own payouts | Simulated |
| Host cancellation (Q-06) | A plain refund before release | Reverse the transfer and refund the fee; can fail if the host's balance is short | Native on the host account | Simulated |
| Gift held 12 months, redirectable (PRD-33) | Yes, in Ramble's balance | Needs a second path | No | Simulated |
| Gift cards (PRD-34) | No | No | No | n/a |
| Fraud rules (PRD-17) | Ramble's | Ramble's | Each host's | None |
| Wallet domains (PRD-18) | Ramble's only | Ramble's only | Each host's | Not real |
| Code paths | One | Two (bookings, gifts) | Two, plus per-host operations | One |
| Counsel risk | Ramble holds host money | Lower: money sits with the host | Lowest | None |

Ramble keeps about $17.15 (11.5%) on an average $149.50 booking after Stripe's US card fee under A or B. Other providers were screened: PayPal's delayed disbursement releases automatically within 28 days (too short for gifts) and needs partner approval; Adyen for Platforms looked sales-led. Neither was costed.

## Recommendation

**A: Stripe Connect with separate charges and transfers,** Payment Element plus Express Checkout Element for the guest, and a fake gateway behind the same interface for tests, local development, and load tests. The demo runs on a Stripe sandbox, because the money flow, wallets, and webhooks are the parts worth proving.

1. **Charge on Ramble's platform account,** with no `on_behalf_of`. Guests see Ramble on their statement. The host-as-seller model lives in the marketplace terms and host agreement.
2. **Host accounts:** recipient accounts with the Express dashboard, Ramble as fee and loss collector, Stripe-hosted onboarding during the white-glove call (PRD-39), and negative balances debited from the host's bank (for disputes after release). Pin the API version.
3. **Release rule:** a weekly job transfers ticket minus 15%, plus tax, for sessions that ended at least 24 hours earlier, one transfer per booking with an idempotency key. Ramble's own payouts stay manual so held host money isn't swept out with earned commission. A daily reconciliation checks "owed to hosts" against the Stripe balance (PRD-57).
4. **Cancellations:** before release, a plain full refund from Ramble's balance (Q-06 in one call). After release, refund and reverse the transfer.
5. **Fraud:** Radar from day one, with dynamic 3-D Secure; review Radar's paid tier after a month of dispute data. Hold limits stay in ADR 0002.
6. **Idempotency:** layered as in ADR 0002, with FORM-8 settled as above.
7. **Tax:** manual per-experience treatment and a configured rate at launch (PRD-78). Revisit Stripe Tax after Q-12 and counsel.
8. **PCI:** SAQ A. The embedded Payment Element brings the script-control criterion, so the checkout page carries a report-only Content Security Policy first (SEC-10), a script inventory, and no third-party tags.
9. **Gift cards (PRD-34):** not on Stripe. If Q-13 requires them, Ramble sells them as its own product on its own ledger (Q-01 option a for that product only), or uses a licensed gift-card vendor, after the legal questions below.
10. **Code shape:** one payments service module with a Stripe adapter and a fake adapter, wire types mapped inside (ARCH-2, ARCH-3), secrets server-only, and the webhook route as a thin shell.

**Demo on a Stripe sandbox:** real Payment Element and Express Checkout with test cards for success, decline, 3-D Secure, and Radar blocks; connected test host accounts; transfers, reversals, refunds, and test disputes. Simulated or limited: Apple Pay needs a real Apple device and a registered HTTPS domain, so preview URLs won't show wallets; real verification, bank payouts, and dispute timelines; holding a gift for 12 months. Dave creates the Stripe account and sandbox.

## Decisions for Dave at the sitting

1. Adopt A over B, on condition that counsel doesn't rule out Ramble holding host money.
2. Who absorbs the card fee Stripe doesn't return on a host or weather cancellation (about $4.64 on an average booking): Ramble, as Q-03 and Q-06 imply today, or the host, through the host agreement?
3. Commission on a partially refunded booking: on the amount kept, or on the original?
4. Gift cards (PRD-34): Ramble's own ledger product, a vendor, or cut if Q-13 allows.
5. The demo runs on a Stripe sandbox, which needs a Stripe account.

## Risks this research raised

- **Gift law may break PRD-33.** New York's gift certificate statute (GBL 396-i, as published) sets a minimum expiry of nine years, and federal rules (12 CFR 1005.20) were not checked. If either covers a gift of one experience, the PRD's 12-month validity and refund are wrong and gift money may not be able to sit in a Stripe balance. Counsel question (Q-16).
- **Card refunds at 12 months.** Stripe documents no card refund age limit (bank debits have 180 days). Ask Stripe before building PRD-33's refund path.
- **Ramble holding host money** needs counsel's view; Stripe offers no escrow and tells platforms to ask counsel.
- **Stripe's Connect review.** Third-party agents and stored value are on its restricted list, review time isn't documented, and December 1 is six weeks away. For the real job, apply early.
- **Disputes after release** can arrive up to 120 days after the event; recovery depends on the host agreement and negative-balance debits.
- **Apple Pay inside Instagram and mail in-app browsers** is not verified; test on a device before launch.
- Stripe's docs carry no revision dates and some pages address coding agents directly; the research did not act on those instructions. Pin versions and recheck at build time.

## What would change the call

- Counsel says Ramble can't hold host money, or Stripe caps how long the platform balance can hold it below 12 months: bookings move to B, and gifts are redesigned. If Ramble can't touch funds at all, C, and gifts fall away.
- Gift law applies to PRD-33: gift liability likely moves off Stripe entirely.
- Stripe declines or restricts the Connect application: PayPal or Adyen come back, with a longer lead time.
- Dispute rate above 0.5%: Radar's paid rules or a longer release delay.
- Dave wants no Stripe account for the demo: D alone, with wallets, fraud rules, and Connect shown as simulations.
