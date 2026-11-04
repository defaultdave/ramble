// Run by `pnpm lint`. Lists test files over the warning size so they get split before they sprawl.
// The hard limit is coded but off: switch ENFORCE_HARD_LIMIT on once the existing oversized files are split.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const WARN_LINES = 500;
export const HARD_LIMIT_LINES = 800;
export const ENFORCE_HARD_LIMIT = false;
export const ROOTS = ["src", "tests", "e2e"];
const TEST_FILE = /\.(test\.tsx?|spec\.ts)$/;
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);

export interface SizedFile {
  path: string;
  lines: number;
}

export interface Report {
  warnings: SizedFile[];
  violations: SizedFile[];
  exitCode: 0 | 1;
  text: string;
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

export function countLines(content: string): number {
  if (content === "") return 0;
  const breaks = content.split("\n").length - 1;
  return content.endsWith("\n") ? breaks : breaks + 1;
}

export function buildReport(files: SizedFile[], enforceHardLimit: boolean = ENFORCE_HARD_LIMIT): Report {
  const warnings = files
    .filter((f) => f.lines > WARN_LINES)
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  const violations = warnings.filter((f) => f.lines > HARD_LIMIT_LINES);
  const exitCode = enforceHardLimit && violations.length > 0 ? 1 : 0;
  if (warnings.length === 0) {
    return { warnings, violations, exitCode, text: `test-size: no test file is over ${WARN_LINES} lines.` };
  }
  const width = String(warnings[0]!.lines).length;
  const rows = warnings.map(
    (f) => `  ${String(f.lines).padStart(width)}  ${f.path}${f.lines > HARD_LIMIT_LINES ? "  (over hard limit)" : ""}`,
  );
  const limit = enforceHardLimit
    ? `hard limit ${HARD_LIMIT_LINES} enforced`
    : `hard limit ${HARD_LIMIT_LINES} not enforced yet`;
  return {
    warnings,
    violations,
    exitCode,
    text: [`test-size: warning, ${warnings.length} test file(s) over ${WARN_LINES} lines (${limit}):`, ...rows].join(
      "\n",
    ),
  };
}

export function findTestFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
      } else if (isTestFile(entry.name)) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

if (import.meta.main) {
  const files = ROOTS.flatMap(findTestFiles).map((path) => ({ path, lines: countLines(readFileSync(path, "utf8")) }));
  const report = buildReport(files);
  console.log(report.text);
  process.exit(report.exitCode);
}
