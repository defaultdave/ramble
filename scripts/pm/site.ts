#!/usr/bin/env bun
// The PM's only route to the ramble-pm repo, which needs no PR: commit everything changed there and push main as the App.
//   bun scripts/pm/site.ts dir                  print the ramble-pm checkout's path
//   bun scripts/pm/site.ts publish "<message>"  commit all changes in it and push main
import { statSync } from "node:fs";
import { join } from "node:path";
import { mintToken } from "../merge-desk/app-token.ts";
import { gitAuthEnv, Refused, type RunResult } from "../merge-desk/agent-git.ts";

export const SITE_REPO = "defaultdave/ramble-pm";
export const STATUS_LIMIT_BYTES = 25 * 1024;
const HTTPS_REMOTE = new RegExp(`^https://github\\.com/${SITE_REPO}(\\.git)?$`);

export interface SiteDeps {
  dir: string;
  token: () => Promise<string>;
  run: (command: string[], env: Record<string, string>) => RunResult;
  /** Size of a file in the checkout, in bytes. */
  size: (relativePath: string) => number;
}

/**
 * The ramble-pm checkout. `RAMBLE_PM_DIR` points elsewhere; the default sits beside the main checkout, so it resolves
 * the same from any worktree.
 * @throws when git cannot find this repository
 */
function siteDir(): string {
  if (process.env.RAMBLE_PM_DIR) return process.env.RAMBLE_PM_DIR;
  const p = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: new URL(".", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) throw new Error(`git rev-parse failed: ${p.stderr.toString().trim()}`);
  const commonDir = p.stdout.toString().trim();
  return `${commonDir.replace(/\/\.git\/?$/, "").replace(/\/[^/]+$/, "")}/ramble-pm`;
}

/** The App token rides an HTTPS header, so any other push URL would push as Dave or to another repo. */
export function assertSiteRemote(pushUrls: string[]): void {
  if (pushUrls.length === 0 || !pushUrls.every((url) => HTTPS_REMOTE.test(url))) {
    throw new Refused(`refused: every push URL of origin must be https://github.com/${SITE_REPO}`);
  }
}

/** Every PM turn re-reads STATUS.md, so its size is paid on every call. */
export function assertStatusSize(bytes: number): void {
  if (bytes > STATUS_LIMIT_BYTES) {
    throw new Refused(
      `refused: STATUS.md is ${Math.ceil(bytes / 1024)} KB, over the ${STATUS_LIMIT_BYTES / 1024} KB limit; move history into lanes/<name>.md or delta-log.md and publish again`,
    );
  }
}

/** A blank or multi-line message would hide what the commit records in the log. */
export function assertMessage(message: string | undefined): asserts message is string {
  if (!message?.trim() || message.includes("\n")) throw new Refused("refused: give one non-empty line as the commit message");
}

function must(result: RunResult, what: string): RunResult {
  if (result.code !== 0) throw new Error(`${what} failed (exit ${result.code})`);
  return result;
}

/**
 * Commits every change in the ramble-pm checkout and pushes main as the App. Pushes even when nothing is new to commit,
 * so an earlier commit that failed to push goes out.
 * @throws Refused on a bad message, a STATUS.md over the size limit, a checkout not on main, or a push URL that is not
 * the ramble-pm repo
 */
export async function publish(message: string | undefined, deps: SiteDeps): Promise<void> {
  assertMessage(message);
  assertStatusSize(deps.size("STATUS.md"));
  const git = (...args: string[]) => ["git", "-C", deps.dir, ...args];
  const branch = must(deps.run(git("branch", "--show-current"), {}), "git branch").stdout.trim();
  if (branch !== "main") throw new Refused(`refused: ${deps.dir} is on ${branch || "a detached HEAD"}, not main`);
  const urls = deps.run(git("remote", "get-url", "--push", "--all", "origin"), {});
  assertSiteRemote(urls.code === 0 ? urls.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : []);
  must(deps.run(git("add", "--all"), {}), "git add");
  const staged = deps.run(git("diff", "--cached", "--quiet"), {});
  if (staged.code !== 0) must(deps.run(git("commit", "--quiet", "-m", message), {}), "git commit");
  must(deps.run(git("push", "origin", "refs/heads/main:refs/heads/main"), gitAuthEnv(await deps.token())), "git push");
}

if (import.meta.main) {
  const [command, message] = Bun.argv.slice(2);
  try {
    if (command === "dir") {
      process.stdout.write(`${siteDir()}\n`);
    } else if (command === "publish") {
      const dir = siteDir();
      await publish(message, {
        dir,
        token: () => mintToken(),
        run: (cmd, env) => {
          const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" });
          return { code: p.exitCode ?? 1, stdout: p.stdout.toString() };
        },
        size: (relativePath) => statSync(join(dir, relativePath)).size,
      });
      console.error(`published ${SITE_REPO}`);
    } else {
      throw new Refused('usage: bun scripts/pm/site.ts dir | publish "<message>"');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(error instanceof Refused ? 2 : 1);
  }
}
