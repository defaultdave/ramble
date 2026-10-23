#!/usr/bin/env bun
// The PM's only route to the ramble-pm repo, which needs no PR: commit everything changed there and push main as the App.
//   bun scripts/plan/site.ts dir                  print the ramble-pm checkout's path
//   bun scripts/plan/site.ts publish "<message>"  commit all changes in it and push main
import { mintToken } from "../merge-desk/app-token.ts";
import { gitAuthEnv, Refused, type RunResult } from "../merge-desk/agent-git.ts";
import { siteDir } from "./units";

export const SITE_REPO = "defaultdave/ramble-pm";
const HTTPS_REMOTE = new RegExp(`^https://github\\.com/${SITE_REPO}(\\.git)?$`);

export interface SiteDeps {
  dir: string;
  token: () => Promise<string>;
  run: (command: string[], env: Record<string, string>) => RunResult;
}

/** The App token rides an HTTPS header, so any other push URL would push as Dave or to another repo. */
export function assertSiteRemote(pushUrls: string[]): void {
  if (pushUrls.length === 0 || !pushUrls.every((url) => HTTPS_REMOTE.test(url))) {
    throw new Refused(`refused: every push URL of origin must be https://github.com/${SITE_REPO}`);
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
 * @throws Refused on a bad message, a checkout not on main, or a push URL that is not the ramble-pm repo
 */
export async function publish(message: string | undefined, deps: SiteDeps): Promise<void> {
  assertMessage(message);
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
      await publish(message, {
        dir: siteDir(),
        token: () => mintToken(),
        run: (cmd, env) => {
          const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" });
          return { code: p.exitCode ?? 1, stdout: p.stdout.toString() };
        },
      });
      console.error(`published ${SITE_REPO}`);
    } else {
      throw new Refused('usage: bun scripts/plan/site.ts dir | publish "<message>"');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(error instanceof Refused ? 2 : 1);
  }
}
