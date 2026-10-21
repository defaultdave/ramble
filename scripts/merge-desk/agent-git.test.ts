import { expect, test } from "bun:test";
import { automerge, type Deps, gitAuthEnv, pr, push, Refused, type RunResult } from "./agent-git.ts";

const VIEW_OK = '{"headRefName":"unit/U-001","baseRefName":"main"}';

function fakeDeps(options: { branch?: string; view?: string; remote?: string } = {}) {
  const calls: { command: string[]; env: Record<string, string> }[] = [];
  const deps: Deps = {
    token: async () => "ghs_fake",
    currentBranch: () => options.branch ?? "unit/U-001",
    run: (command, env): RunResult => {
      calls.push({ command, env });
      if (command[1] === "remote") return { code: 0, stdout: options.remote ?? "https://github.com/defaultdave/ramble.git\n" };
      const isView = command[1] === "pr" && command[2] === "view";
      return { code: 0, stdout: isView ? (options.view ?? VIEW_OK) : "" };
    },
  };
  return { deps, calls };
}

test("push sends an allowed branch with the token in the environment, not the command line", async () => {
  const { deps, calls } = fakeDeps();
  await push("unit/U-001", deps);
  expect(calls).toHaveLength(2);
  expect(calls[1].command).toEqual(["git", "push", "origin", "refs/heads/unit/U-001:refs/heads/unit/U-001"]);
  expect(calls[1].command.join(" ")).not.toContain("ghs_fake");
  expect(calls[1].env.GIT_CONFIG_VALUE_1).toBe(gitAuthEnv("ghs_fake").GIT_CONFIG_VALUE_1);
  expect(calls[1].env.GIT_CONFIG_KEY_0).toBe("credential.helper");
});

test.each(["pm/status-2026-10-21", "revert/pr-12", "sync/2026-10-27", "unit/U-064a", "unit/U-118"])(
  "push allows %s",
  async (branch) => {
    const { deps, calls } = fakeDeps();
    await push(branch, deps);
    expect(calls).toHaveLength(2);
  },
);

test.each(["main", "integration", "feature/x", "unit/001", "unit/U-1/../main", "pm/", "--force", "origin/main", ""])(
  "push refuses %p and runs nothing",
  async (branch) => {
    const { deps, calls } = fakeDeps();
    await expect(push(branch, deps)).rejects.toBeInstanceOf(Refused);
    expect(calls).toHaveLength(0);
  },
);

test.each([
  "git@github.com:defaultdave/ramble.git\n",
  "https://github.com/defaultdave/ramble.git\ngit@github.com:defaultdave/ramble.git\n",
  "https://github.com/someone/else.git\n",
  "",
])("push refuses when the push URLs are %p and never mints a token", async (remote) => {
  const { deps, calls } = fakeDeps({ remote });
  await expect(push("unit/U-001", deps)).rejects.toBeInstanceOf(Refused);
  expect(calls.every((call) => call.command[1] === "remote")).toBe(true);
  expect(calls.some((call) => "GH_TOKEN" in call.env || "GIT_CONFIG_COUNT" in call.env)).toBe(false);
});

test("pr opens from the current branch into main or integration", async () => {
  const { deps, calls } = fakeDeps();
  await pr("integration", "U-002: skeleton", "/tmp/body.md", deps);
  expect(calls[0].command).toEqual([
    "gh", "pr", "create", "--repo", "defaultdave/ramble", "--base", "integration", "--head", "unit/U-001",
    "--title", "U-002: skeleton", "--body-file", "/tmp/body.md",
  ]);
  expect(calls[0].env.GH_TOKEN).toBe("ghs_fake");
});

test("pr refuses any base other than main or integration", async () => {
  const { deps, calls } = fakeDeps();
  await expect(pr("release", "t", "b", deps)).rejects.toBeInstanceOf(Refused);
  expect(calls).toHaveLength(0);
});

test("pr refuses to open a PR whose head is integration", async () => {
  const { deps, calls } = fakeDeps({ branch: "integration" });
  await expect(pr("main", "Promote", "b", deps)).rejects.toBeInstanceOf(Refused);
  expect(calls).toHaveLength(0);
});

test("automerge sets squash auto-merge and never passes --admin", async () => {
  const { deps, calls } = fakeDeps();
  await automerge("42", deps);
  const merge = calls.find((call) => call.command[2] === "merge");
  expect(merge?.command).toEqual(["gh", "pr", "merge", "42", "--repo", "defaultdave/ramble", "--auto", "--squash"]);
  expect(merge?.command).not.toContain("--admin");
});

test.each([
  ['{"headRefName":"sync/2026-10-27","baseRefName":"integration"}', "--merge"],
  ['{"headRefName":"main","baseRefName":"integration"}', "--merge"],
  ['{"headRefName":"unit/U-002","baseRefName":"integration"}', "--squash"],
  ['{"headRefName":"unit/U-001","baseRefName":"main"}', "--squash"],
])("automerge on %s uses %s", async (view, method) => {
  const { deps, calls } = fakeDeps({ view });
  await automerge("7", deps);
  expect(calls.find((call) => call.command[2] === "merge")?.command).toContain(method);
});

test("automerge refuses a promotion PR and does not merge", async () => {
  const { deps, calls } = fakeDeps({ view: '{"headRefName":"integration","baseRefName":"main"}' });
  await expect(automerge("99", deps)).rejects.toBeInstanceOf(Refused);
  expect(calls.some((call) => call.command[2] === "merge")).toBe(false);
});

test("automerge refuses an argument that looks like a flag", async () => {
  const { deps, calls } = fakeDeps();
  await expect(automerge("--admin", deps)).rejects.toBeInstanceOf(Refused);
  expect(calls).toHaveLength(0);
});

test("a failing command surfaces as an error without the token", async () => {
  const { deps } = fakeDeps();
  deps.run = (command) =>
    command[1] === "remote" ? { code: 0, stdout: "https://github.com/defaultdave/ramble\n" } : { code: 128, stdout: "" };
  const error = await push("unit/U-001", deps).catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("git push failed (exit 128)");
});
