import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  InvalidTargetError,
  parsePullRequestRef,
  resolveRepoTarget,
} from "../../src/github/repo-target.js";

describe("resolveRepoTarget", () => {
  test("falls back to the working directory when nothing was given", async () => {
    for (const value of [undefined, "", "   "]) {
      assert.deepEqual(await resolveRepoTarget(value), { kind: "cwd" });
    }
  });

  test("takes an owner/name slug as it is", async () => {
    assert.deepEqual(await resolveRepoTarget("acme/tienda"), { kind: "slug", slug: "acme/tienda" });
  });

  test("trims what the client sent", async () => {
    assert.deepEqual(await resolveRepoTarget("  acme/tienda  "), { kind: "slug", slug: "acme/tienda" });
  });

  test("accepts the dots, dashes and underscores a repository name can carry", async () => {
    assert.deepEqual(await resolveRepoTarget("acme-inc/tienda_v2.0"), {
      kind: "slug",
      slug: "acme-inc/tienda_v2.0",
    });
  });

  test("reads a GitHub URL down to the slug", async () => {
    for (const url of [
      "https://github.com/acme/tienda",
      "https://github.com/acme/tienda.git",
      "https://github.com/acme/tienda/pull/200",
      "https://github.com/acme/tienda/pull/200/files",
      "http://github.com/acme/tienda",
    ]) {
      assert.deepEqual(await resolveRepoTarget(url), { kind: "slug", slug: "acme/tienda" }, url);
    }
  });

  test("qualifies the slug with the host when it is not github.com", async () => {
    assert.deepEqual(await resolveRepoTarget("https://git.acme.io/acme/tienda"), {
      kind: "slug",
      slug: "git.acme.io/acme/tienda",
    });
  });

  test("reads an SSH remote, with or without the scheme and the .git suffix", async () => {
    for (const url of [
      "git@github.com:acme/tienda.git",
      "git@github.com:acme/tienda",
      "ssh://git@github.com/acme/tienda.git",
    ]) {
      assert.deepEqual(await resolveRepoTarget(url), { kind: "slug", slug: "acme/tienda" }, url);
    }
  });

  test("qualifies an SSH remote outside github.com too", async () => {
    assert.deepEqual(await resolveRepoTarget("git@git.acme.io:acme/tienda.git"), {
      kind: "slug",
      slug: "git.acme.io/acme/tienda",
    });
  });

  test("accepts a local clone by absolute path", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "code-review-steps-target-"));
    t.after(() => rm(dir, { recursive: true, force: true }));

    await mkdir(join(dir, ".git"));

    assert.deepEqual(await resolveRepoTarget(dir), { kind: "path", cwd: dir });
  });

  test("accepts a worktree, where .git is a file and not a directory", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "code-review-steps-target-"));
    t.after(() => rm(dir, { recursive: true, force: true }));

    await writeFile(join(dir, ".git"), "gitdir: /elsewhere\n", "utf8");

    assert.deepEqual(await resolveRepoTarget(dir), { kind: "path", cwd: dir });
  });

  test("accepts a relative path only when it says so explicitly", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "code-review-steps-target-"));
    const previous = process.cwd();

    t.after(async () => {
      process.chdir(previous);
      await rm(dir, { recursive: true, force: true });
    });

    await mkdir(join(dir, ".git"));
    process.chdir(dir);

    assert.deepEqual(await resolveRepoTarget("."), { kind: "path", cwd: process.cwd() });
  });

  test("reads a bare foo/bar as a slug, not as a directory", async () => {
    // The far more common case, and the reason a path has to be explicit.
    assert.deepEqual(await resolveRepoTarget("acme/tienda"), { kind: "slug", slug: "acme/tienda" });
  });

  test("expands ~ to the home directory before looking", async () => {
    await assert.rejects(
      resolveRepoTarget("~/no-such-clone-for-tests"),
      (error: unknown) => {
        assert.ok(error instanceof InvalidTargetError);
        assert.match(error.message, new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
        return true;
      },
    );
  });

  test("says the path does not exist when it does not", async () => {
    await assert.rejects(resolveRepoTarget("/no/such/path/for/tests"), /no existe o no es accesible/u);
  });

  test("says the path is not a directory when it is a file", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "code-review-steps-target-"));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const file = join(dir, "archivo.txt");
    await writeFile(file, "", "utf8");

    await assert.rejects(resolveRepoTarget(file), /no es un directorio/u);
  });

  test("says the directory is not a repository when it has no .git", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "code-review-steps-target-"));
    t.after(() => rm(dir, { recursive: true, force: true }));

    await assert.rejects(resolveRepoTarget(dir), /no es un repositorio git: no contiene \.git/u);
  });

  test("refuses what it cannot read, naming the three shapes it takes", async () => {
    for (const value of ["acme", "acme/tienda/extra", "https://github.com/acme", "ftp://github.com/acme/tienda"]) {
      await assert.rejects(
        resolveRepoTarget(value),
        (error: unknown) => {
          assert.ok(error instanceof InvalidTargetError, value);
          assert.match(error.message, /owner\/nombre/u);
          return true;
        },
        value,
      );
    }
  });
});

describe("parsePullRequestRef", () => {
  test("takes a positive integer", () => {
    assert.deepEqual(parsePullRequestRef(200), { number: 200 });
  });

  test("takes the number as a string, with or without the leading hash", () => {
    assert.deepEqual(parsePullRequestRef("200"), { number: 200 });
    assert.deepEqual(parsePullRequestRef("#200"), { number: 200 });
    assert.deepEqual(parsePullRequestRef("  200  "), { number: 200 });
  });

  test("reads the number and the repository out of a full URL", () => {
    assert.deepEqual(parsePullRequestRef("https://github.com/acme/tienda/pull/200"), {
      number: 200,
      slug: "acme/tienda",
    });
  });

  test("reads a URL that carries a path after the number", () => {
    assert.deepEqual(parsePullRequestRef("https://github.com/acme/tienda/pull/200/files"), {
      number: 200,
      slug: "acme/tienda",
    });
  });

  test("qualifies the slug with the host outside github.com", () => {
    assert.deepEqual(parsePullRequestRef("https://git.acme.io/acme/tienda/pull/7"), {
      number: 7,
      slug: "git.acme.io/acme/tienda",
    });
  });

  test("refuses a number that is not a positive integer", () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => parsePullRequestRef(value), InvalidTargetError, String(value));
    }
  });

  test("refuses a repository URL with no pull request in it", () => {
    assert.throws(() => parsePullRequestRef("https://github.com/acme/tienda"), InvalidTargetError);
  });

  test("refuses text that is neither a number nor a URL, and shows both shapes", () => {
    assert.throws(() => parsePullRequestRef("el ultimo"), (error: unknown) => {
      assert.ok(error instanceof InvalidTargetError);
      assert.match(error.message, /Pasa el número \(200\) o la URL completa/u);
      return true;
    });
  });
});
