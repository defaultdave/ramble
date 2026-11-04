// A Claude Code PostToolUse hook on Edit and Write: lints the edited file for ticket-number comments as soon as the
// agent writes one, instead of at the next `pnpm lint`. Exit 2 hands the report back to the agent to fix.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { ticketCommentsConfig } from "../../eslint.config.ticket-comments.mjs";

const LINTED = /^(src|tests|e2e|scripts)\/.+\.(ts|tsx|mts|mjs)$/;

interface HookInput {
  tool_input?: { file_path?: string };
}

/** The checkout that holds the file, so an edit in another worktree is read against its own root. */
function repoRoot(filePath: string): string | null {
  const git = spawnSync("git", ["-C", dirname(filePath), "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return git.status === 0 ? git.stdout.trim() : null;
}

/**
 * @param filePath the edited file, absolute or relative to `root`
 * @param root the repository root
 * @returns the path relative to `root` when ESLint covers it, else null
 */
export function lintedPath(filePath: string, root: string): string | null {
  const path = relative(root, filePath);
  return LINTED.test(path) ? path : null;
}

/** @returns one line per offending comment, `path:line message` */
export function ticketCommentReport(path: string, code: string): string[] {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(code, [{ files: ["**/*.{ts,tsx,mts,mjs}"], languageOptions: { parser: tseslint.parser } }, ticketCommentsConfig], path);
  return messages.map((message) => `${path}:${message.line} ${message.message}`);
}

if (import.meta.main) {
  const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  const filePath = input.tool_input?.file_path;
  const root = filePath ? repoRoot(filePath) : null;
  const path = filePath && root ? lintedPath(filePath, root) : null;
  if (filePath && path) {
    const report = ticketCommentReport(path, readFileSync(filePath, "utf8"));
    if (report.length > 0) {
      console.error(report.join("\n"));
      process.exit(2);
    }
  }
}
