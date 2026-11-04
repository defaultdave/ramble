import { expect, test } from "bun:test";
import { checkScope, parseUnits, type ScopeInput, unitsYamlViolations } from "./scope-check.ts";

const units = parseUnits(`units:
  - id: U-001
    title: "x"
    review: standard
  - id: U-002
    review: critical
  - id: U-064a
    review: standard
`);

const baseInput: ScopeInput = {
  title: "U-001: Repo and CI",
  base: "main",
  head: "unit/U-001",
  changedFiles: ["src/app/page.tsx"],
  units,
};
const check = (patch: Partial<ScopeInput>) => checkScope({ ...baseInput, ...patch });

test("parseUnits reads ids and tiers", () => {
  expect([...units]).toEqual([["U-001", "standard"], ["U-002", "critical"], ["U-064a", "standard"]]);
});

test.each(['review: "critical"', "review: critical # unchanged", "review: 'critical'", "review: {x: 1}"])(
  "parseUnits reads the tier from parsed YAML, so %s is critical",
  (line) => {
    expect(parseUnits(`units:\n  - id: U-009\n    ${line}\n`).get("U-009")).toBe("critical");
  },
);

test("a formatting-only edit of a critical tier leaves the tier critical for later PRs", () => {
  const edited = UNITS_YAML.replace("review: critical", 'review: "critical"');
  expect(unitsYamlViolations(UNITS_YAML, edited)).toEqual([]);
  expect(parseUnits(edited).get("U-001")).toBe("critical");
});

test("a standard unit into main passes", () => {
  expect(check({}).ok).toBe(true);
});

test.each([
  ["a standard unit", { title: "U-001: Repo and CI", head: "unit/U-001" }],
  ["a critical unit", { title: "U-002: skeleton", head: "unit/U-002" }],
  ["a bookkeeping PR", { title: "PM bookkeeping: x", head: "pm/x", changedFiles: ["docs/plan/STATUS.md"] }],
  ["a critical revert", { title: "Revert: U-002: skeleton", head: "revert/pr-9" }],
])("rule 1: %s into any base but main fails, into main passes", (_, patch: Partial<ScopeInput>) => {
  expect(check({ ...patch, base: "integration" })).toEqual({ ok: false, reason: "Base must be main, not integration." });
  expect(check(patch).ok).toBe(true);
});

test.each([
  ["a title without a unit ID", "Fix things"],
  ["an unknown unit ID", "U-999: ghost"],
  ["a unit ID that only prefixes another", "U-0011: nope"],
  ["a revert of a title without a unit ID", "Revert: Fix things"],
])("rule 2: %s fails", (_label, title) => {
  expect(check({ title }).ok).toBe(false);
});

test("rule 2: a letter-suffixed unit passes from its own branch", () => {
  expect(check({ title: "U-064a: gift chain", head: "unit/U-064a-gifts" }).ok).toBe(true);
});

test.each(["Revert: U-001: Repo and CI", "Revert: Revert: U-001: Repo and CI"])("rule 2: %s passes from a revert branch", (title) => {
  expect(check({ title, head: "revert/pr-12" }).ok).toBe(true);
});

test("rule 2: a critical unit cannot borrow a standard unit's title (branch and title must agree)", () => {
  const verdict = check({ title: "U-001: Repo and CI", head: "unit/U-002", base: "main" });
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toContain("must be unit/U-001");
});

test.each(["feature/x", "unit/U-0011", "unit/U-001x", "pm/U-001", "unit/u-001"])("rule 2: branch %s does not match title U-001", (head) => {
  expect(check({ head }).ok).toBe(false);
});

test("rule 2: a unit branch may carry a suffix", () => {
  expect(check({ head: "unit/U-001-hardening" }).ok).toBe(true);
});

test("rule 2: a revert PR must come from revert/pr-<number>", () => {
  expect(check({ title: "Revert: U-001: x", head: "unit/U-001" }).ok).toBe(false);
  expect(check({ title: "Revert: U-001: x", head: "revert/pr-1x" }).ok).toBe(false);
});

test.each([
  ".github/workflows/x.yml",
  ".claude/settings.json",
  "CLAUDE.md",
  "scripts/merge-desk/agent-git.ts",
  "docs/adr/0010.md",
  "docs/plan/units.yaml",
])("rule 3: a unit PR touching %s fails", (file) => {
  const verdict = check({ changedFiles: ["src/a.ts", file] });
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toContain(file);
});

test("rule 3: a bookkeeping PR touching only the three plan files into main passes", () => {
  const verdict = check({
    title: "PM bookkeeping: mark U-118 done",
    head: "pm/status",
    changedFiles: ["docs/plan/STATUS.md", "docs/plan/delta-log.md"],
  });
  expect(verdict.ok).toBe(true);
});

test("rule 3: a bookkeeping PR touching any other file fails", () => {
  const changedFiles = ["docs/plan/units.yaml", "docs/plan/DECISIONS.md"];
  expect(check({ title: "PM bookkeeping: x", head: "pm/x", changedFiles }).ok).toBe(false);
});

test.each(["docs/plan/units.yaml", "Docs/Plan/UNITS.yaml", "CLAUDE.MD", ".GitHub/workflows/x.yml", "Scripts/Merge-Desk/a.ts"])(
  "rule 3: protected paths match case-insensitively (%s)",
  (file) => {
    expect(check({ changedFiles: [file] }).ok).toBe(false);
  },
);

const UNITS_YAML = `# header
units:
  - id: U-001
    title: "x"
    depends_on: [U-118]
    estimate_days: { o: 1, m: 2, p: 3 }
    review: critical
    execution_reason: "because
      of money"
    actual_days: null
    status: todo
    note: "a"
  - id: U-002
    review: standard
    status: todo
`;
const bookkeeping = (after: string) =>
  check({
    title: "PM bookkeeping: units",
    head: "pm/units",
    changedFiles: ["docs/plan/units.yaml"],
    unitsYaml: { base: UNITS_YAML, head: after },
  });

test("bookkeeping may change status, actuals, tokens, and notes", () => {
  const after = UNITS_YAML.replace("status: todo", "status: done").replace("actual_days: null", "actual_days: 2.5").replace('note: "a"', 'note: "b"');
  expect(unitsYamlViolations(UNITS_YAML, after)).toEqual([]);
  expect(bookkeeping(after).ok).toBe(true);
});

test("bookkeeping may add an actuals field a unit lacked", () => {
  expect(bookkeeping(UNITS_YAML.replace("    review: standard\n", "    review: standard\n    dave_minutes: 40\n")).ok).toBe(true);
});

test.each([
  ["review tier", "review: critical", "review: standard", "U-001.review"],
  ["execution reason (multi-line)", "of money", "of nothing", "U-001.execution_reason"],
  ["dependencies", "[U-118]", "[]", "U-001.depends_on"],
  ["estimate", "m: 2", "m: 1", "U-001.estimate_days"],
  ["title", 'title: "x"', 'title: "y"', "U-001.title"],
  ["a top-level key", "units:\n", "version: 2\nunits:\n", "top-level version"],
])("bookkeeping cannot change %s", (_label, from, to, expected) => {
  const after = UNITS_YAML.replace(from, to);
  expect(unitsYamlViolations(UNITS_YAML, after)).toContain(expected);
  expect(bookkeeping(after).ok).toBe(false);
});

test("bookkeeping cannot smuggle a unit in as a flow-style entry after the last field", () => {
  const after = `${UNITS_YAML}  - {id: U-999, review: standard, status: todo}\n`;
  expect(unitsYamlViolations(UNITS_YAML, after)).toContain("units were added, removed, or reordered");
  expect(bookkeeping(after).ok).toBe(false);
});

test("bookkeeping cannot hide a changed field behind flow-style syntax", () => {
  const after = UNITS_YAML.replace("    review: standard\n", "    {review: critical}\n");
  expect(() => unitsYamlViolations(UNITS_YAML, after)).toThrow();
});

test("a comment-only change is harmless", () => {
  expect(unitsYamlViolations(UNITS_YAML, UNITS_YAML.replace("# header", "# changed"))).toEqual([]);
});

test("bookkeeping cannot add, remove, or reorder units", () => {
  expect(bookkeeping(UNITS_YAML + "  - id: U-003\n    review: standard\n").ok).toBe(false);
  expect(bookkeeping(UNITS_YAML.replace(/  - id: U-002[\s\S]*/, "")).ok).toBe(false);
});

test("bookkeeping changing units.yaml without the before/after text fails closed", () => {
  const verdict = check({ title: "PM bookkeeping: units", head: "pm/units", changedFiles: ["docs/plan/units.yaml"] });
  expect(verdict.ok).toBe(false);
});

