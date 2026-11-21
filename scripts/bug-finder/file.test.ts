import { expect, test } from "bun:test";
import { citedFile, FINDER_LABEL, OPT_IN_LABEL, pick, unitLine } from "../nightly-fix/pick.ts";
import { createIssue, decide, type DecideInput, findDuplicate, type Finding, issueBody, listKnown, parseFinding, plain, readVerdict } from "./file.ts";

const raw = {
  kind: "bug",
  lens: "bug",
  title: "Second refund request is refused after the first one fails",
  file: "src/server/db/orderRefundRetry.ts",
  lines: "62-71",
  unit: "U-077",
  size: "S",
  evidence: "db test: two failed refunds, one retry clears the flag.",
  fix: "Clear the flag only when no failed refund is left.",
};
const finding = (over: Record<string, unknown> = {}) => (parseFinding({ ...raw, ...over }) as { finding: Finding }).finding;

test("a complete finding parses, and a none carries what was checked", () => {
  expect(parseFinding(raw)).toEqual({ finding: { ...raw, requirement: null } });
  expect(parseFinding({ none: "checkout at 390 px, holds, expiry" })).toEqual({ none: "checkout at 390 px, holds, expiry" });
});

test.each([
  ["not an object", "oops", "not an object"],
  ["an empty none", { none: " " }, "`none` must say"],
  ["an unknown kind", { ...raw, kind: "taste" }, "kind must be"],
  ["an unknown lens", { ...raw, lens: "copy" }, "lens must be"],
  ["an unknown size", { ...raw, size: "XL" }, "size must be"],
  ["no title", { ...raw, title: "" }, "title is empty"],
  ["a path that climbs out", { ...raw, file: "../etc/passwd" }, "not a repo-relative path"],
  ["a path with a backtick", { ...raw, file: "src/a`b.ts" }, "not a repo-relative path"],
  ["an absolute path", { ...raw, file: "/etc/passwd" }, "not a repo-relative path"],
  ["no line", { ...raw, lines: "" }, "lines must be"],
  ["a word for the line", { ...raw, lines: "top" }, "lines must be"],
  ["a bad unit", { ...raw, unit: "unit 77" }, "unit must look like"],
  ["no evidence", { ...raw, evidence: "" }, "needs evidence"],
  ["no fix", { ...raw, fix: "" }, "fix suggestion"],
  ["an improvement with no requirement", { ...raw, kind: "improvement" }, "must cite a requirement"],
])("rejects %s", (_why, input, reason) => {
  const parsed = parseFinding(input) as { invalid: string };
  expect(parsed.invalid).toContain(reason);
});

test("an improvement that cites a requirement is accepted", () => {
  expect(finding({ kind: "improvement", requirement: "PRD-68: LCP under 2.5 s" }).requirement).toBe("PRD-68: LCP under 2.5 s");
});

test("accepts a Next route-group path and a numeric line", () => {
  const f = finding({ file: "src/app/(checkout)/checkout/[holdId]/page.tsx", lines: 42 });
  expect(f.lines).toBe("42");
  expect(citedFile(issueBody(f, { area: "checkout", runUrl: "r", unitKnown: true, offLimits: false }))).toBe(f.file);
});

test("text from the agent is capped, flattened in titles, and cannot mention anyone", () => {
  expect(plain("ping @defaultdave and a@b")).toBe("ping @​defaultdave and a@​b");
  expect(plain("x".repeat(5000))).toHaveLength(4000);
  expect(finding({ title: "line one\nline two" }).title).toBe("line one line two");
});

test.each([
  ["CONFIRMED\nwhy", "CONFIRMED"],
  ["REFUTED\nwhy", "REFUTED"],
  ["confirmed", "NO-VERDICT"],
  ["CONFIRMED, mostly", "NO-VERDICT"],
  ["", "NO-VERDICT"],
])("verdict %j reads as %s", (text, verdict) => {
  expect(readVerdict(text)).toBe(verdict);
});

const known = [
  { number: 10, title: "Something else", body: "`src/server/db/orderRefundRetry.ts:60-65`: other.\n- Unit: U-077" },
  { number: 11, title: "Elsewhere", body: "`src/lib/x.ts:1`: x" },
];

test.each([
  ["lines overlap in the same file", finding(), 10],
  ["a single cited line inside the range", finding({ lines: "64" }), 10],
  ["the same title, shouted", finding({ title: "ELSEWHERE!", file: "src/lib/y.ts", lines: "9" }), 11],
  ["the same file, other lines", finding({ lines: "70-80" }), null],
  ["another file", finding({ file: "src/lib/y.ts" }), null],
  ["a ticket with no cited lines", finding({ file: "src/lib/z.ts" }), null],
])("duplicate check: %s", (_why, f, number) => {
  expect(findDuplicate(f, known)).toBe(number);
});

test("the issue body is the record the picker reads", () => {
  const body = issueBody(finding(), { area: "ops", runUrl: "https://example.test/run/1", unitKnown: true, offLimits: false });
  expect(body.split("\n")[0]).toBe("`src/server/db/orderRefundRetry.ts:62-71`: Second refund request is refused after the first one fails");
  expect(body).toContain("\n- Unit: U-077\n");
  expect(body).toContain("**Evidence**\n\ndb test");
  expect(body).toContain("**Suggested fix**\n\nClear the flag");
  expect(body).toContain("https://example.test/run/1");
  expect(body).not.toContain("Requirement or rule");
  expect(unitLine(body)).toBe("U-077");
});

test("an improvement body carries its requirement", () => {
  const body = issueBody(finding({ kind: "improvement", requirement: "B6" }), { area: "ops", runUrl: "r", unitKnown: true, offLimits: false });
  expect(body).toContain("**Requirement or rule it fails**\n\nB6");
});

const input = (over: Partial<DecideInput> = {}): DecideInput => ({
  parsed: parseFinding(raw),
  verdict: "CONFIRMED",
  known: [],
  unitIds: new Set(["U-077", "U-072"]),
  area: "ops",
  runUrl: "https://example.test/run/1",
  fileExists: () => true,
  ...over,
});

test("files a confirmed, new finding with audit and finder labels, never the opt-in", () => {
  const decision = decide(input());
  expect(decision).toMatchObject({ action: "file", title: raw.title, labels: ["audit", FINDER_LABEL] });
  expect((decision as { labels: string[] }).labels).not.toContain(OPT_IN_LABEL);
});

test("the filed ticket qualifies for the picker once the owner adds the opt-in", () => {
  const decision = decide(input()) as { body: string; title: string; labels: string[] };
  const issue = { number: 50, title: decision.title, body: decision.body, author: "app/defaultdave-agents", labels: [...decision.labels, OPT_IN_LABEL] };
  expect(pick({ issues: [issue], openBranches: [], prTitles: new Map(), units: new Map([["U-077", "critical" as const]]) })).toMatchObject({
    issue: 50,
    unit: "U-077",
    branch: "unit/U-077-nightly-50",
  });
});

test.each([
  ["an off-limits file", { parsed: parseFinding({ ...raw, file: "package.json" }) }],
  ["a unit missing from units.yaml", { unitIds: new Set(["U-072"]) }],
])("labels needs-owner for %s", (_why, over) => {
  expect((decide(input(over)) as { labels: string[] }).labels).toContain("needs-owner");
});

test("a unit missing from units.yaml leaves no Unit line, so the picker cannot take it", () => {
  const body = (decide(input({ unitIds: new Set() })) as { body: string }).body;
  expect(unitLine(body)).toBeNull();
});

test.each([
  ["a none", { parsed: parseFinding({ none: "browse at 320 px" }) }, "Checked: browse at 320 px"],
  ["an invalid finding", { parsed: parseFinding({ ...raw, lines: "" }) }, "rejected"],
  ["a refuted finding", { verdict: "REFUTED" as const }, "verifier said REFUTED"],
  ["no verdict", { verdict: "NO-VERDICT" as const }, "verifier said NO-VERDICT"],
  ["a file that is not in the repo", { fileExists: () => false }, "not in the repository"],
  ["a duplicate", { known }, null],
])("files nothing for %s", (_why, over, why) => {
  const decision = decide(input(over.known ? { known: [{ number: 10, title: "t", body: known[0].body }] } : over));
  expect(decision.action).toBe("stop");
  if (why) expect((decision as { why: string }).why).toContain(why);
  else expect((decision as { why: string }).why).toContain("duplicates #10");
});

test("listKnown pages through issues and skips pull requests", async () => {
  const pages: unknown[][] = [
    Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `t${i}`, body: null })),
    [{ number: 101, title: "pr", body: "", pull_request: {} }, { number: 102, title: "last", body: "b" }],
  ];
  const urls: string[] = [];
  const doFetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(pages[urls.length - 1]));
  }) as unknown as typeof fetch;
  const found = await listKnown("tok", doFetch);
  expect(found).toHaveLength(101);
  expect(found.at(-1)).toEqual({ number: 102, title: "last", body: "b" });
  expect(found[0].body).toBe("");
  expect(urls[0]).toContain("state=all&labels=audit");
});

test("createIssue posts the fields and returns the number; a refusal throws", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const ok = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ number: 77 }));
  }) as unknown as typeof fetch;
  const decision = decide(input()) as Extract<ReturnType<typeof decide>, { action: "file" }>;
  expect(await createIssue(decision, "tok", ok)).toBe(77);
  expect(JSON.parse(sent!.init.body as string)).toEqual({ title: decision.title, body: decision.body, labels: decision.labels });
  expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  const refused = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
  await expect(createIssue(decision, "tok", refused)).rejects.toThrow("HTTP 403");
});
