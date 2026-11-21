import { expect, test } from "bun:test";
import { guard, parseNumstat } from "./guard.ts";
import { FINDER_LABEL, type Issue, OPT_IN_LABEL, type PickInput, pick, TICKET_AUTHOR } from "./pick.ts";

const units = new Map([
  ["U-077", "critical" as const],
  ["U-072", "standard" as const],
]);

const issue = (number: number, over: Partial<Issue> = {}): Issue => ({
  number,
  title: `N1113-1 a finding for ${number}`,
  body: "`src/server/db/orderRefundRetry.ts:62-71`: wrong.\n- From: 967\n- Status when filed: open",
  author: TICKET_AUTHOR,
  labels: ["audit", OPT_IN_LABEL],
  ...over,
});

const input = (issues: Issue[], over: Partial<PickInput> = {}): PickInput => ({
  issues,
  openBranches: [],
  prTitles: new Map([
    [967, "U-077: ops bookings actions"],
    [905, "PM bookkeeping: tooling"],
  ]),
  units,
  ...over,
});

test("picks the lowest qualifying ticket and names its unit branch and title", () => {
  expect(pick(input([issue(20), issue(12)]))).toEqual({
    issue: 12,
    unit: "U-077",
    tier: "critical",
    file: "src/server/db/orderRefundRetry.ts",
    branch: "unit/U-077-nightly-12",
    title: "U-077: a finding for 12 (#12)",
  });
});

test.each([
  ["another author", { author: "defaultdave" }],
  ["no opt-in label", { labels: ["audit"] }],
  ["needs-owner", { labels: ["audit", OPT_IN_LABEL, "needs-owner"] }],
  ["an off-limits file", { body: "`scripts/merge-desk/scope-check.ts:5` x\n- From: 967" }],
  ["a config file", { body: "`package.json:3` x\n- From: 967" }],
  ["a source PR with no unit", { body: "`src/lib/a.ts:1` x\n- From: PR 905" }],
  ["no cited file", { body: "Something is wrong.\n- From: 967" }],
])("skips a ticket with %s", (_why, over) => {
  expect(pick(input([issue(5, over)]))).toHaveProperty("skip");
});

const finderIssue = (number: number, over: Partial<Issue> = {}): Issue =>
  issue(number, {
    labels: ["audit", FINDER_LABEL, OPT_IN_LABEL],
    body: "`src/lib/refundRetry.ts:62-71`: wrong.\n- Unit: U-072\n- Lens: bug",
    ...over,
  });

test("picks a finder ticket by its Unit line, with no source PR", () => {
  expect(pick(input([finderIssue(30)]))).toMatchObject({
    issue: 30,
    unit: "U-072",
    tier: "standard",
    file: "src/lib/refundRetry.ts",
    branch: "unit/U-072-nightly-30",
  });
});

test.each([
  ["no finder label", { labels: ["audit", OPT_IN_LABEL] }],
  ["a unit missing from units.yaml", { body: "`src/lib/a.ts:1` x\n- Unit: U-999" }],
  ["an indented Unit line", { body: "`src/lib/a.ts:1` x\n  - Unit: U-072" }],
  ["an unopted finder ticket", { labels: ["audit", FINDER_LABEL] }],
])("skips a finder ticket with %s", (_why, over) => {
  expect(pick(input([finderIssue(31, over)]))).toHaveProperty("skip");
});

test("skips the night while a nightly fix PR is open", () => {
  expect(pick(input([issue(5)], { openBranches: ["unit/U-072-nightly-4"] }))).toEqual({
    skip: "a nightly fix PR is still open; one at a time",
  });
});

test.each([
  ["a small fix and its test", [{ path: "src/lib/a.ts", lines: 12 }, { path: "src/lib/a.test.ts", lines: 30 }], []],
  ["an off-limits file", [{ path: "src/lib/a.ts", lines: 2 }, { path: ".github/workflows/ci.yml", lines: 1 }], [".github/workflows/ci.yml is off limits"]],
  ["no change", [], ["no change"]],
  ["too many lines", [{ path: "src/lib/a.ts", lines: 301 }], ["301 lines changed, limit 300"]],
])("guard: %s", (_why, changes, reasons) => {
  expect(guard(changes)).toEqual(reasons);
});

test("parseNumstat counts added and removed lines, binary as one", () => {
  expect(parseNumstat("3\t1\tsrc/a.ts\n-\t-\tpublic/x.png\n")).toEqual([
    { path: "src/a.ts", lines: 4 },
    { path: "public/x.png", lines: 1 },
  ]);
});
