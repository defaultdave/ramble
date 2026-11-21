// Refuses the fix agent's working tree before anything is committed (ADR 0011): off-limits files, or a diff too big for one ticket.
// Run after the agent, in the checkout: bun scripts/nightly-fix/guard.ts
import { isOffLimits } from "./pick.ts";

/** One ticket's fix plus its test; a larger change is the lead's to cut, not the night's. */
export const MAX_CHANGED_LINES = 300;
export const MAX_FILES = 6;

export interface FileChange {
  path: string;
  lines: number;
}

/** Returns the reasons to refuse, empty when the change may be committed. */
export function guard(changes: FileChange[]): string[] {
  const reasons = changes.filter((c) => isOffLimits(c.path)).map((c) => `${c.path} is off limits`);
  const lines = changes.reduce((sum, c) => sum + c.lines, 0);
  if (changes.length === 0) reasons.push("no change");
  if (changes.length > MAX_FILES) reasons.push(`${changes.length} files changed, limit ${MAX_FILES}`);
  if (lines > MAX_CHANGED_LINES) reasons.push(`${lines} lines changed, limit ${MAX_CHANGED_LINES}`);
  return reasons;
}

/** Parses `git diff --cached --numstat` after `git add -A`, so new files count. Binary files count as one line. */
export function parseNumstat(text: string): FileChange[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split("\t");
      return { path, lines: added === "-" ? 1 : Number(added) + Number(removed) };
    });
}

if (import.meta.main) {
  Bun.spawnSync(["git", "add", "-A"]);
  const numstat = Bun.spawnSync(["git", "diff", "--cached", "--numstat"], { stdout: "pipe" }).stdout.toString();
  const reasons = guard(parseNumstat(numstat));
  if (reasons.length) {
    console.error(`refused: ${reasons.join("; ")}`);
    process.exit(1);
  }
  console.log("guard: change is inside the limits");
}
