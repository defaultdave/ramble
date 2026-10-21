import { expect, test } from "bun:test";
import { checkScope, parseUnits, PROMOTION_MESSAGE, type ScopeInput } from "./scope-check.ts";

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
  carriesIntegrationCommits: false,
  aheadOfMain: true,
};
const check = (patch: Partial<ScopeInput>) => checkScope({ ...baseInput, ...patch });

test("parseUnits reads ids and tiers", () => {
  expect([...units]).toEqual([["U-001", "standard"], ["U-002", "critical"], ["U-064a", "standard"]]);
});

test("a standard unit into main passes", () => {
  expect(check({}).ok).toBe(true);
});

test("rule 1: a promotion PR always fails with the runbook message", () => {
  expect(check({ head: "integration", base: "main", title: "Promote integration" })).toEqual({
    ok: false,
    reason: PROMOTION_MESSAGE,
  });
});

test("rule 2: a sync PR from main or sync/ into integration passes", () => {
  expect(check({ head: "sync/2026-10-27", base: "integration", title: "Sync", aheadOfMain: false }).ok).toBe(true);
  expect(check({ head: "main", base: "integration", title: "Sync", aheadOfMain: false }).ok).toBe(true);
});

test("rule 2: a sync branch with commits beyond main fails", () => {
  expect(check({ head: "sync/x", base: "integration", title: "Sync", aheadOfMain: true }).ok).toBe(false);
});

test.each([
  ["a title without a unit ID", "Fix things"],
  ["an unknown unit ID", "U-999: ghost"],
  ["a unit ID that only prefixes another", "U-0011: nope"],
  ["a revert of a title without a unit ID", "Revert: Fix things"],
])("rule 3: %s fails", (_label, title) => {
  expect(check({ title }).ok).toBe(false);
});

test.each(["U-064a: gift chain", "Revert: U-001: Repo and CI"])("rule 3: %s passes", (title) => {
  expect(check({ title }).ok).toBe(true);
});

test.each([
  ".github/workflows/x.yml",
  ".claude/settings.json",
  "CLAUDE.md",
  "scripts/merge-desk/agent-git.ts",
  "docs/adr/0010.md",
  "docs/plan/units.yaml",
])("rule 4: a unit PR touching %s fails", (file) => {
  const verdict = check({ changedFiles: ["src/a.ts", file] });
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toContain(file);
});

test("rule 4: a bookkeeping PR touching only the three plan files into main passes", () => {
  const verdict = check({
    title: "PM bookkeeping: mark U-118 done",
    changedFiles: ["docs/plan/units.yaml", "docs/plan/STATUS.md", "docs/plan/delta-log.md"],
  });
  expect(verdict.ok).toBe(true);
});

test("rule 4: a bookkeeping PR touching any other file fails", () => {
  const changedFiles = ["docs/plan/units.yaml", "docs/plan/DECISIONS.md"];
  expect(check({ title: "PM bookkeeping: x", changedFiles }).ok).toBe(false);
});

test("rule 4: a bookkeeping PR into integration fails", () => {
  const verdict = check({ title: "PM bookkeeping: x", base: "integration", changedFiles: ["docs/plan/STATUS.md"] });
  expect(verdict.ok).toBe(false);
});

test("rule 5: a critical unit into main fails, into integration passes", () => {
  expect(check({ title: "U-002: skeleton", base: "main" }).ok).toBe(false);
  expect(check({ title: "U-002: skeleton", base: "integration" }).ok).toBe(true);
});

test("rule 5: a standard unit that carries integration commits must target integration", () => {
  expect(check({ carriesIntegrationCommits: true, base: "main" }).ok).toBe(false);
  expect(check({ carriesIntegrationCommits: true, base: "integration" }).ok).toBe(true);
});

test("rule 5: a standard unit may target integration without integration commits", () => {
  expect(check({ base: "integration" }).ok).toBe(true);
});
