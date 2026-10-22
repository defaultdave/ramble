// The agents' only route to GitHub (runbook B1). Every call uses the App token, never Dave's login.
//   bun scripts/merge-desk/agent-git.ts push <branch>
//   bun scripts/merge-desk/agent-git.ts pr <base> <title> <body-file>
//   bun scripts/merge-desk/agent-git.ts automerge <pr number or branch>
//   bun scripts/merge-desk/agent-git.ts review <pr number or branch>
import { mintToken } from "./app-token.ts";

export const REPO = "defaultdave/ramble";
/** The owner's login. An approval from it counts because agents author PRs as the App, not as the owner. */
export const REVIEWER = "defaultdave";
const BRANCH_PATTERN = /^(unit\/U-[0-9A-Za-z][0-9A-Za-z._-]*|(pm|revert|sync)\/[0-9A-Za-z][0-9A-Za-z._/-]*)$/;

export class Refused extends Error {}

export interface RunResult {
  code: number;
  stdout: string;
}

export interface Deps {
  token: () => Promise<string>;
  run: (command: string[], env: Record<string, string>) => RunResult;
  currentBranch: () => string;
}

/** Only unit/U-…, pm/…, revert/…, and sync/… branches may be pushed; main and integration never. */
export function assertPushable(branch: string): void {
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock")) {
    throw new Refused(`refused: ${branch} is not a unit/U-…, pm/…, revert/…, or sync/… branch`);
  }
}

export function assertBase(base: string): void {
  if (base !== "main" && base !== "integration") throw new Refused(`refused: base must be main or integration, not ${base}`);
}

export function assertNotPromotion(head: string): void {
  if (head === "integration") throw new Refused("refused: integration is promoted by Dave, not by an agent");
}

/** Git config passed through the environment so the token never appears in a command line or URL. */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

function must(result: RunResult, what: string): RunResult {
  if (result.code !== 0) throw new Error(`${what} failed (exit ${result.code})`);
  return result;
}

const HTTPS_REMOTE = new RegExp(`^https://github\\.com/${REPO}(\\.git)?$`);

/** The App token rides an HTTPS header, so a push URL that is SSH (or another repo) would use Dave's own login. */
export function assertHttpsRemote(deps: Deps): void {
  const result = deps.run(["git", "remote", "get-url", "--push", "--all", "origin"], {});
  const urls = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (result.code !== 0 || urls.length === 0 || !urls.every((url) => HTTPS_REMOTE.test(url))) {
    throw new Refused(`refused: every push URL of origin must be https://github.com/${REPO}`);
  }
}

export async function push(branch: string, deps: Deps): Promise<void> {
  assertPushable(branch);
  assertHttpsRemote(deps);
  must(
    deps.run(["git", "push", "origin", `refs/heads/${branch}:refs/heads/${branch}`], gitAuthEnv(await deps.token())),
    "git push",
  );
}

export async function pr(base: string, title: string, bodyFile: string, deps: Deps): Promise<void> {
  assertBase(base);
  const head = deps.currentBranch();
  assertNotPromotion(head);
  if (head === base) throw new Refused(`refused: head and base are both ${base}`);
  const command = [
    "gh", "pr", "create", "--repo", REPO, "--base", base, "--head", head, "--title", title, "--body-file", bodyFile,
  ];
  must(deps.run(command, { GH_TOKEN: await deps.token() }), "gh pr create");
}

export function isSync(head: string, base: string): boolean {
  return base === "integration" && (head === "main" || head.startsWith("sync/"));
}

export async function automerge(target: string, deps: Deps): Promise<void> {
  if (target.startsWith("-")) throw new Refused(`refused: ${target} is not a PR number or branch`);
  const token = await deps.token();
  const view = must(
    deps.run(["gh", "pr", "view", target, "--repo", REPO, "--json", "headRefName,baseRefName"], { GH_TOKEN: token }),
    "gh pr view",
  );
  const { headRefName, baseRefName } = JSON.parse(view.stdout) as { headRefName: string; baseRefName: string };
  assertNotPromotion(headRefName);
  // A sync PR keeps main's commits as ancestors (merge commit); squashing would make the next sync conflict.
  const method = isSync(headRefName, baseRefName) ? "--merge" : "--squash";
  must(deps.run(["gh", "pr", "merge", target, "--repo", REPO, "--auto", method], { GH_TOKEN: token }), "gh pr merge");
}

/** Requests the owner's review as the App: every PR while approvals are required, and people checks and escalations after. */
export async function review(target: string, deps: Deps): Promise<void> {
  if (target.startsWith("-")) throw new Refused(`refused: ${target} is not a PR number or branch`);
  must(
    deps.run(["gh", "pr", "edit", target, "--repo", REPO, "--add-reviewer", REVIEWER], { GH_TOKEN: await deps.token() }),
    "gh pr edit",
  );
}

function realDeps(): Deps {
  let cached: Promise<string> | null = null;
  const spawn = (command: string[], env: Record<string, string>): RunResult => {
    const result = Bun.spawnSync(command, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" });
    return { code: result.exitCode ?? 1, stdout: result.stdout.toString() };
  };
  return {
    token: () => (cached ??= mintToken()),
    run: (command, env) => {
      const result = spawn(command, env);
      if (command[0] === "gh" && command[2] !== "view") process.stdout.write(result.stdout);
      return result;
    },
    currentBranch: () => spawn(["git", "branch", "--show-current"], {}).stdout.trim(),
  };
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const usage = () => {
    throw new Error(
      "usage: agent-git.ts push <branch> | pr <base> <title> <body-file> | automerge <pr or branch> | review <pr or branch>",
    );
  };
  try {
    const deps = realDeps();
    if (command === "push" && args.length === 1) await push(args[0], deps);
    else if (command === "pr" && args.length === 3) await pr(args[0], args[1], args[2], deps);
    else if (command === "automerge" && args.length === 1) await automerge(args[0], deps);
    else if (command === "review" && args.length === 1) await review(args[0], deps);
    else usage();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(error instanceof Refused ? 2 : 1);
  }
}
