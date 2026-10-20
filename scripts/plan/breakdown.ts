#!/usr/bin/env bun
// P4 artifact 2: the work breakdown, docs/plan/02-work-breakdown.md, as a view of docs/plan/units.yaml.
//
// Run: bun scripts/plan/breakdown.ts [--write]
//   --write   replace docs/plan/02-work-breakdown.md (default: print it)
//
// units.yaml is the record. The counts, the section tables, and the PRD coverage are computed from it; the prose around
// them (the four completeness review rounds and Dave's scope decisions) is fixed here, because it records what happened.

import { flag, loadUnits, lookup, type Unit } from "./units";

/** Sections in the order the breakdown shows them: the `section` key in units.yaml, then its heading. */
const SECTIONS: [string, string][] = [
  ["platform", "Platform and walking skeleton"],
  ["data", "Data contracts and the data layer"],
  ["design-system", "Design system in code"],
  ["catalog", "Catalog and editorial pages"],
  ["experience", "Experience page and booking entry"],
  ["checkout", "Checkout and payments"],
  ["post-booking", "Post-booking"],
  ["gifting", "Gifting"],
  ["host", "Host tools"],
  ["ops", "Ops and admin"],
  ["measurement", "Measurement and reporting"],
  ["seo", "Addresses, SEO, and the move"],
  ["launch", "Quality, operations, and launch"],
];

const TARGET = new URL("../../docs/plan/02-work-breakdown.md", import.meta.url);

/** PRD requirements are numbered 01 to 78; the coverage appendix shows them in three columns. */
const PRD_COUNT = 78;
const PRD_COLUMNS = 3;
/** Must and Should requirements left out of the breakdown (scope question 3); the rest without units are Later. */
const NOT_BROKEN_DOWN = new Set([34, 43]);

const FRONTMATTER = [
  "---",
  "title: Ramble work breakdown (P4 artifact 2)",
  "status: scope approved 2026-10-18 (Dave), after four completeness review rounds; dependencies revised at artifact 4 (2026-10-19)",
  "date: 2026-10-18",
  "author: ramble-pm",
  "traces_to: docs/plan/01-design-doc.md (approved 2026-10-18), docs/product/PRD.md v1.0, ADRs 0001 to 0010 with amendments, docs/design/ (P3)",
  "---",
];

const INTRO =
  "Section, then slice, then unit. A **unit** is one pull-request-sized ticket: roughly half a day to three days of work, one reviewable change, with its own acceptance check. Anything larger gets split before it is estimated. Unit IDs are stable: a split keeps the original ID with a letter (U-047a, U-047b), and new units take the next free number. `units.yaml` (artifacts 3 to 5) carries each unit's scores, dependencies, routing, estimates, and actuals.";

const NEEDS =
  "**Needs** lists the units a unit can't start without. It was a first pass at artifact 2. The artifact 4 graph review (2026-10-19) revised it, split U-116 out of U-004a, and added U-117 (the rich-text format and renderer); see `04-dependency-graph.md`. `units.yaml` is the record, and this view is generated from it.";

const FOUNDATION =
  '"Foundation" units trace to the ADRs and non-functional requirements rather than one feature (repository, skeleton, caching, logging, seed, Code Connect).';

/** The completeness review, one paragraph per round (2026-10-18). */
const REVIEW_ROUNDS = [
  "**Round 1.** Six reviewers checked the first draft (104 units) against one source each: PRD requirements; the ADRs and the Tier A list; the design doc's contracts and flows; the P3 screens and states; host, ops, and money operations; and launch work with unit sizing. Skeptical verifiers then tried to refute every finding. Of 66 findings, 57 held (15 missing work, 15 oversized units, 19 wrong dependencies, 4 double-counted, 4 mis-prioritized) and 8 were refuted. Where verifiers proposed different fixes for one problem, the PM picked one.",
  "**Round 2.** Checkers confirmed 52 of the 57 fixes landed (44 as proposed, 8 another acceptable way) and 5 landed wrong; two fresh reviewers found 20 more problems the edits exposed, of which 18 held. All 23 were applied.",
  "**Round 3.** 21 of the 23 round-2 fixes landed; 2 small slips were corrected. With a higher bar (half a day of effect or more), fresh reviewers found 13 more, of which 11 held, mostly dependency wiring plus five small owners. All were applied. The launch review now waits on every Must and Foundation unit, computed from the graph rather than listed by hand.",
  "**Round 4.** 10 of the 13 round-3 fixes landed; 3 missing dependencies were added. Fresh reviewers found 14 more, of which 11 held: half-day owners (ending an experience for PRD-33, one-off dated sessions for event hosts, cancellation windows, an alerts helper, redemption-page error states) and wiring. All were applied. Confirmed findings per round: 57, 18, 11, 11, getting smaller each round. What remains is below the noise the estimate ranges absorb, and scoring (artifact 3) is a further check on unit size.",
];

const MAIN_CHANGES = [
  "New units: guest account (U-107, Should), ops session management (U-108), the paying-hold lapse job (U-106), the refund path in `confirmOrder` (U-109), the money-held view as its own Should (U-110), pricing lines (U-111), ops staff and roles admin (U-112), ops gift support (U-113), synthetic booking isolation (U-114), the launch cutover rehearsal (U-115), and the booking-path smoke with the nightly suite (U-105).",
  "Splits: sign-in versus passkeys and step-up (U-004), CSP versus rate limits (U-008), holds core versus hold rules (U-014), seed tooling versus curated content (U-021), the `startPayment` action versus the checkout page (U-047), the payments port versus the fake payment UI (U-045), gift purchase (U-062), redemption (U-064), and exchange (U-065) into server and page halves, gift expiry versus reinstatement (U-066), host onboarding into setup, editor, and availability (U-074), the editorial admin into editing, collections, and pages (U-076), transfers versus reconciliation (U-079), support versus private-request queues (U-083), and the post-launch tail (U-094).",
  "Ownership made explicit: pricing and the tax-rate setting; the card-fee posting; the `confirmOrder` branches (booking U-049, gift purchase U-062a, redemption U-064a, exchange U-065, refund path U-109); gift reinstatement (U-066); dispute postings in reconciliation (U-079b, a Must) with the dispute record staying a Should (U-081); the `Clock` port; `updateAllocation`; booked-session time changes; token routes kept out of indexes in the Must units; the launch cutover runbook.",
  "Race and idempotency tests added for the gift paths (U-062a, U-064a, U-065a, U-066), traced by the launch review; dispute losses netted from the host's next payout (U-079a); a rolling 12-week session horizon job (U-074c); the guest-side bookings-paused and gifts-off states.",
  "About thirty dependencies added, most visibly: sign-in needs email (U-004a on U-006), holds wait for the Neon spike (U-014a on U-013), the launch review waits for every launch unit (U-104), and transfers wait for `confirmOrder` (U-079a on U-049).",
];

const DECIDED = "> **Decided 2026-10-18 (Dave):** all three as recommended.";

/** The PRD column: two-digit requirement numbers, or "(platform)" for a unit that traces to the ADRs instead. */
const prdCell = (u: Unit) => (u.prd.length ? u.prd.map(pad).join(", ") : "(platform)");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The Priority column: the priority, then the P4 spike, real-job, and after-launch flags, then the unit's note. */
function priorityCell(u: Unit): string {
  const parts: string[] = [u.priority];
  if (u.spike) parts.push("spike, P4");
  if (u.mode === "real-job") parts.push("real job only");
  if (u.phase === "post-launch") parts.push("after launch");
  if (u.note) parts.push(u.note);
  return parts.join("; ");
}

const all = await loadUnits();
const badField = all.find((u) => typeof u.slice !== "string" || typeof u.scope !== "string" || !Array.isArray(u.prd));
if (badField) throw new Error(`${badField.id} is missing slice, scope, or prd`);
const bySection = new Map<string, Unit[]>(SECTIONS.map(([key]) => [key, []]));
for (const u of all) {
  const list = bySection.get(u.section);
  if (!list) throw new Error(`${u.id} has section ${u.section}, which the breakdown has no heading for`);
  list.push(u);
}
const count = (xs: Unit[], priority: Unit["priority"]) => xs.filter((u) => u.priority === priority).length;
const shoulds = count(all, "Should");

const md: string[] = [];
const line = (s = "") => md.push(s);

for (const s of FRONTMATTER) line(s);
line();
line("# Work breakdown");
line();
line(INTRO);
line();
line(NEEDS);
line();

line("## Summary");
line();
line("| Section | Units | Must | Should | Foundation |");
line("|---|---|---|---|---|");
for (const [key, name] of SECTIONS) {
  const xs = lookup(bySection, key);
  line(`| ${name} | ${xs.length} | ${count(xs, "Must")} | ${count(xs, "Should")} | ${count(xs, "Foundation")} |`);
}
line(`| **Total** | **${all.length}** | **${count(all, "Must")}** | **${shoulds}** | **${count(all, "Foundation")}** |`);
line();
line(FOUNDATION);
line();
line(
  "- **Spikes in P4, before estimating:** U-013 (the reserve path under load on Neon; U-014a waits for it) and U-028 (Code Connect, which needs the Figma library published). The provider's card-refund age limit is a question to the provider, not a unit.",
);
line(
  "- **Real job only:** U-046, the Stripe Connect adapter. The demo runs the fake gateway (ADR 0003), so this unit is estimated for the real job and not built in P5.",
);
line(
  "- **After launch:** U-094a and U-094b, redirect fixes and retiring the old site, because the plan ends at the old site switched off (planning method).",
);
line(
  `- **Reference class:** the prior checkout epic was about 65 PRs in 13 sections over 3 months with one engineer. This breakdown has ${all.length} units in ${SECTIONS.length} sections for a whole marketplace (guest site, host tools, ops, money, migration). The estimate (artifact 6) uses that comparison as its cross-check.`,
);
line();

line("## Completeness review (2026-10-18)");
line();
for (const round of REVIEW_ROUNDS) {
  line(round);
  line();
}
line("Main changes across both rounds:");
line();
for (const change of MAIN_CHANGES) line(`- ${change}`);
line();

line("## Scope questions for Dave");
line();
line(DECIDED);
line();
line(
  "1. **The Stripe adapter (U-046) is estimated but not built.** PRD section 11 keeps simulated requirements in the plan so the estimate reflects the real job; ADR 0003 runs the demo on the fake gateway. Recommended: keep it in the estimate, skip it in P5.",
);
line(
  `2. **Shoulds are broken down and estimated** (${shoulds} units), so the estimate shows what each costs. The PRD cut order applies after the estimate, not before.`,
);
line(
  "3. **Not broken down:** gift cards (PRD-34, first to cut under the working assumption that the sponsor doesn't need them); live booking-system connections and the availability port's external adapters (PRD-43, a post-launch Should, ADR 0002); every Later item; the Perf Lab branch (a separate branch after the build, ADR 0001); swapping in the designer's real logo and illustrations (they don't exist in this demo).",
);
line();

for (const [key, name] of SECTIONS) {
  line(`## ${name}`);
  line();
  line("| ID | Slice | Unit | Scope | PRD | Priority | Needs |");
  line("|---|---|---|---|---|---|---|");
  for (const u of lookup(bySection, key))
    line(`| ${u.id} | ${u.slice} | ${u.title} | ${u.scope} | ${prdCell(u)} | ${priorityCell(u)} | ${u.depends_on.join(", ")} |`);
  line();
}

const coverage = new Map<number, string[]>();
for (const u of all) for (const p of u.prd) coverage.set(p, [...(coverage.get(p) ?? []), u.id]);
const coverageCell = (p: number) => coverage.get(p)?.join(", ") ?? (NOT_BROKEN_DOWN.has(p) ? "not broken down" : "Later");
const rows = Math.ceil(PRD_COUNT / PRD_COLUMNS);

line("## Appendix: PRD coverage");
line();
line(
  "Every Must and Should requirement maps to at least one unit, except PRD-34 and PRD-43 (see scope question 3). Later items are not broken down.",
);
line();
line(`|${" PRD | Units |".repeat(PRD_COLUMNS)}`);
line(`|${"---|---|".repeat(PRD_COLUMNS)}`);
for (let i = 0; i < rows; i++) {
  const cells: string[] = [];
  for (let c = 0; c < PRD_COLUMNS; c++) {
    const p = c * rows + i + 1;
    if (p <= PRD_COUNT) cells.push(`${pad(p)} | ${coverageCell(p)}`);
  }
  line(`| ${cells.join(" | ")} |`);
}

const output = `${md.join("\n")}\n`;
if (flag("write")) {
  await Bun.write(TARGET, output);
  console.error(`wrote ${TARGET.pathname}`);
} else {
  process.stdout.write(output);
}
