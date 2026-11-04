import { expect, test } from "bun:test";
import { buildReport, countLines, HARD_LIMIT_LINES, isTestFile, WARN_LINES } from "./test-size.ts";

test.each([
  ["src/lib/a.test.ts", true],
  ["src/components/A.test.tsx", true],
  ["src/server/db/a.db.test.ts", true],
  ["e2e/home.spec.ts", true],
  ["src/lib/a.ts", false],
  ["src/components/A.stories.tsx", false],
  ["tests/stubs/fake.ts", false],
])("isTestFile(%s) is %s", (path, expected) => {
  expect(isTestFile(path)).toBe(expected);
});

test.each([
  ["", 0],
  ["a", 1],
  ["a\n", 1],
  ["a\nb", 2],
  ["a\nb\n", 2],
])("countLines(%j) is %d", (content, expected) => {
  expect(countLines(content)).toBe(expected);
});

const file = (path: string, lines: number) => ({ path, lines });

test("a file at the warning size is not listed, one line over is", () => {
  const report = buildReport([file("a.test.ts", WARN_LINES), file("b.test.ts", WARN_LINES + 1)]);
  expect(report.warnings.map((f) => f.path)).toEqual(["b.test.ts"]);
});

test("warnings list the largest first with line counts and exit 0", () => {
  const report = buildReport([file("small.test.ts", 600), file("big.test.ts", 700)]);
  expect(report.exitCode).toBe(0);
  expect(report.text).toContain("2 test file(s) over 500 lines");
  expect(report.text.indexOf("big.test.ts")).toBeLessThan(report.text.indexOf("small.test.ts"));
  expect(report.text).toContain("700  big.test.ts");
});

test("files over the hard limit exit 0 while enforcement is off, and are marked", () => {
  const report = buildReport([file("huge.test.ts", HARD_LIMIT_LINES + 1)], false);
  expect(report.exitCode).toBe(0);
  expect(report.violations).toHaveLength(1);
  expect(report.text).toContain("over hard limit");
  expect(report.text).toContain("not enforced yet");
});

test.each([
  [HARD_LIMIT_LINES, 0],
  [HARD_LIMIT_LINES + 1, 1],
])("with enforcement on, a %d-line file exits %d", (lines, exitCode) => {
  expect(buildReport([file("a.test.ts", lines)], true).exitCode).toBe(exitCode);
});

test("with no oversized file the report says so and exits 0", () => {
  const report = buildReport([file("a.test.ts", 10)], true);
  expect(report.exitCode).toBe(0);
  expect(report.text).toContain("no test file is over 500 lines");
});
