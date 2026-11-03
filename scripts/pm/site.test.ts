import { expect, test } from "bun:test";
import { gitAuthEnv, Refused, type RunResult } from "../merge-desk/agent-git.ts";
import { publish, type SiteDeps } from "./site.ts";

const DIR = "/work/ramble-pm";

function fakeDeps(options: { branch?: string; remote?: string; staged?: boolean } = {}) {
  const calls: { command: string[]; env: Record<string, string> }[] = [];
  const deps: SiteDeps = {
    dir: DIR,
    token: async () => "ghs_fake",
    run: (command, env): RunResult => {
      calls.push({ command, env });
      const sub = command[3];
      if (sub === "branch") return { code: 0, stdout: `${options.branch ?? "main"}\n` };
      if (sub === "remote") return { code: 0, stdout: options.remote ?? "https://github.com/defaultdave/ramble-pm.git\n" };
      if (sub === "diff") return { code: options.staged === false ? 0 : 1, stdout: "" };
      return { code: 0, stdout: "" };
    },
  };
  const subcommands = () => calls.map((c) => c.command[3]);
  return { deps, calls, subcommands };
}

test("publish commits the changes and pushes main with the token in the environment only", async () => {
  const { deps, calls, subcommands } = fakeDeps();
  await publish("Status after U-003", deps);
  expect(subcommands()).toEqual(["branch", "remote", "add", "diff", "commit", "push"]);
  const push = calls[calls.length - 1];
  expect(push.command).toEqual(["git", "-C", DIR, "push", "origin", "refs/heads/main:refs/heads/main"]);
  expect(push.command.join(" ")).not.toContain("ghs_fake");
  expect(push.env.GIT_CONFIG_VALUE_1).toBe(gitAuthEnv("ghs_fake").GIT_CONFIG_VALUE_1);
});

test("publish with nothing staged skips the commit and still pushes", async () => {
  const { deps, subcommands } = fakeDeps({ staged: false });
  await publish("Retry the push", deps);
  expect(subcommands()).toEqual(["branch", "remote", "add", "diff", "push"]);
});

test.each([
  ["a blank message", { message: "  " }],
  ["a multi-line message", { message: "one\ntwo" }],
  ["a branch other than main", { branch: "draft" }],
  ["a detached HEAD", { branch: "" }],
  ["an SSH push URL", { remote: "git@github.com:defaultdave/ramble-pm.git\n" }],
  ["the code repo's URL", { remote: "https://github.com/defaultdave/ramble.git\n" }],
  ["a second push URL elsewhere", { remote: "https://github.com/defaultdave/ramble-pm.git\nhttps://example.com/x.git\n" }],
])("publish refuses %s and pushes nothing", async (_, o: { message?: string; branch?: string; remote?: string }) => {
  const { deps, subcommands } = fakeDeps(o);
  await expect(publish(o.message ?? "Status", deps)).rejects.toBeInstanceOf(Refused);
  expect(subcommands()).not.toContain("push");
  expect(subcommands()).not.toContain("add");
});
