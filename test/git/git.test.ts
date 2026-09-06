import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GitError, refExists, resolveBranchRef, resolveRange, revParse, runGit } from "../../src/git/git.js";
import { createTempRepo, type TempRepo } from "../helpers/repo.js";

/** A clone with one commit on main, ready to grow branches. */
async function repoWithOneCommit(t: { after(fn: () => unknown): void }): Promise<TempRepo> {
  const repo = await createTempRepo();

  t.after(() => repo.cleanup());

  await repo.write("README.md", "uno\n");
  await repo.commit("primero");

  return repo;
}

describe("runGit", () => {
  test("returns the stdout of git", async (t) => {
    const repo = await repoWithOneCommit(t);

    assert.equal((await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repo.dir)).trim(), "main");
  });

  test("turns a git failure into the message git printed", async (t) => {
    const repo = await repoWithOneCommit(t);

    await assert.rejects(runGit(["cat-file", "-t", "no-such-ref"], repo.dir), (error: unknown) => {
      assert.ok(error instanceof GitError);
      assert.equal(error.message, "fatal: Not a valid object name no-such-ref");
      return true;
    });
  });

  test("says so explicitly when git failed without a message", async (t) => {
    const repo = await repoWithOneCommit(t);

    // --quiet silences git, so only the wrapper has anything left to say.
    await assert.rejects(
      runGit(["rev-parse", "--verify", "--quiet", "no-such-ref"], repo.dir),
      /El comando git falló sin devolver un mensaje de error\./u,
    );
  });

  test("does not go through a shell: an argument is never a command line", async (t) => {
    const repo = await repoWithOneCommit(t);

    // As a shell line this would run `touch`; as an argument it is just a bad ref.
    await assert.rejects(runGit(["rev-parse", "--verify", "HEAD; touch pwned"], repo.dir), GitError);
    await assert.rejects(runGit(["cat-file", "-e", ":pwned"], repo.dir), GitError);
  });
});

describe("refExists", () => {
  test("is true for a ref that resolves to a commit", async (t) => {
    const repo = await repoWithOneCommit(t);

    assert.equal(await refExists("HEAD", repo.dir), true);
    assert.equal(await refExists("main", repo.dir), true);
  });

  test("is false for a ref that is not there, without throwing", async (t) => {
    const repo = await repoWithOneCommit(t);

    assert.equal(await refExists("origin/main", repo.dir), false);
  });

  test("is false for a ref that is not a commit", async (t) => {
    const repo = await repoWithOneCommit(t);

    const blob = (await repo.git("hash-object", "-w", "README.md")).trim();

    assert.equal(await refExists(blob, repo.dir), false);
  });
});

describe("resolveBranchRef", () => {
  test("prefers the remote-tracking branch, which is what GitHub sees", async (t) => {
    const repo = await repoWithOneCommit(t);

    await repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

    assert.equal(await resolveBranchRef("main", repo.dir), "origin/main");
  });

  test("falls back to the local branch when there is no remote-tracking one", async (t) => {
    const repo = await repoWithOneCommit(t);

    assert.equal(await resolveBranchRef("main", repo.dir), "main");
  });

  test("is undefined when neither is there", async (t) => {
    const repo = await repoWithOneCommit(t);

    assert.equal(await resolveBranchRef("no-such-branch", repo.dir), undefined);
  });
});

describe("resolveRange", () => {
  test("builds a three-dot range, so it compares against the merge base", async (t) => {
    const repo = await repoWithOneCommit(t);

    await repo.git("checkout", "--quiet", "-b", "feature");
    await repo.write("app.ts", "dos\n");
    await repo.commit("segundo");

    assert.equal(await resolveRange(repo.dir, "main", "feature"), "main...feature");
  });

  test("uses the remote-tracking refs when they are there", async (t) => {
    const repo = await repoWithOneCommit(t);

    await repo.git("checkout", "--quiet", "-b", "feature");
    await repo.write("app.ts", "dos\n");
    await repo.commit("segundo");
    await repo.git("update-ref", "refs/remotes/origin/main", "main");
    await repo.git("update-ref", "refs/remotes/origin/feature", "feature");

    assert.equal(await resolveRange(repo.dir, "main", "feature"), "origin/main...origin/feature");
  });

  test("names the branch and the clone to fetch into when a branch is missing", async (t) => {
    const repo = await repoWithOneCommit(t);

    await assert.rejects(resolveRange(repo.dir, "main", "no-such-branch"), (error: unknown) => {
      assert.ok(error instanceof GitError);
      assert.match(error.message, /"no-such-branch"/u);
      assert.match(error.message, /git fetch/u);
      assert.ok(error.message.includes(repo.dir));
      return true;
    });
  });

  test("checks the base branch before the head one", async (t) => {
    const repo = await repoWithOneCommit(t);

    await assert.rejects(resolveRange(repo.dir, "no-such-base", "main"), /"no-such-base"/u);
  });
});

describe("revParse", () => {
  test("returns the commit a ref points at, trimmed", async (t) => {
    const repo = await repoWithOneCommit(t);

    const sha = await revParse("HEAD", repo.dir);

    assert.match(sha, /^[0-9a-f]{40}$/u);
    assert.equal(sha, (await repo.git("rev-parse", "HEAD")).trim());
  });

  test("resolves a branch and a tag to the same commit", async (t) => {
    const repo = await repoWithOneCommit(t);

    await repo.git("tag", "v1");

    assert.equal(await revParse("v1", repo.dir), await revParse("main", repo.dir));
  });

  test("fails on a ref that is not there", async (t) => {
    const repo = await repoWithOneCommit(t);

    await assert.rejects(revParse("no-such-ref", repo.dir), GitError);
  });
});
