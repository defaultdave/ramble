#!/usr/bin/env bun
// A Claude Code PostToolUse hook on Bash: when a command cuts a unit worktree (`git worktree add ... unit/U-nnn-...`),
// moves that unit from Todo to In Progress on project board 19, so the board shows what agents are building as they start it.
// Never blocks the agent: a board failure is printed and the hook exits 0.
import { readFileSync } from "node:fs";

const OWNER = "defaultdave";
const BOARD = 19;
const UNIT_WORKTREE = /\bgit\b[^\n;&|]*\bworktree\s+add\b[^\n;&|]*\bunit\/(U-\d+[a-z]?)\b/;

interface HookInput {
  tool_input?: { command?: string };
}

/** A board item as `gh project item-list` prints it. */
export interface BoardItem {
  id: string;
  "unit ID"?: string;
  status?: string;
}

interface Field {
  id: string;
  name: string;
  options?: { id: string; name: string }[];
}

/** @returns the unit a command cuts a worktree for, or null when it cuts none */
export function unitFromCommand(command: string): string | null {
  return UNIT_WORKTREE.exec(command)?.[1] ?? null;
}

/**
 * Only a unit still in Todo moves: one already In Progress or further along keeps its status.
 * @returns the board item to move, or null when there is nothing to change
 */
export function itemToStart(items: BoardItem[], unit: string): BoardItem | null {
  return items.find((item) => item["unit ID"] === unit && item.status === "Todo") ?? null;
}

function gh(args: string[]): string {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

function startOnBoard(unit: string): string {
  const board = [String(BOARD), "--owner", OWNER, "--format", "json"];
  const { items } = JSON.parse(gh(["project", "item-list", ...board, "--limit", "2000"])) as { items: BoardItem[] };
  const item = itemToStart(items, unit);
  if (!item) return `${unit}: not in Todo on board #${BOARD}, left as is`;
  const projectId = gh(["project", "view", ...board, "-q", ".id"]).trim();
  const { fields } = JSON.parse(gh(["project", "field-list", ...board])) as { fields: Field[] };
  const status = fields.find((f) => f.name === "Status");
  const inProgress = status?.options?.find((o) => o.name === "In Progress");
  if (!status || !inProgress) throw new Error(`board #${BOARD} has no Status option "In Progress"`);
  gh(["project", "item-edit", "--id", item.id, "--project-id", projectId, "--field-id", status.id, "--single-select-option-id", inProgress.id]);
  return `${unit}: set to In Progress on board #${BOARD}`;
}

if (import.meta.main) {
  const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  const unit = unitFromCommand(input.tool_input?.command ?? "");
  if (unit) {
    try {
      console.log(startOnBoard(unit));
    } catch (error) {
      console.log(`${unit}: board #${BOARD} not updated (${(error as Error).message}); set it to In Progress by hand`);
    }
  }
}
