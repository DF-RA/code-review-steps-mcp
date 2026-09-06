import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import { extractBaseVersion } from "../../src/analysis/baseline.js";
import { createTempRepo, type TempRepo } from "../helpers/repo.js";

async function repoWithBase(
  t: { after(fn: () => unknown): void },
  files: Record<string, string>,
): Promise<TempRepo> {
  const repo = await createTempRepo();

  t.after(() => repo.cleanup());

  for (const [path, content] of Object.entries(files)) {
    await repo.write(path, content);
  }

  await repo.commit("base");

  return repo;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("extractBaseVersion", () => {
  test("materializes the base version of the files, not the current one", async (t) => {
    const repo = await repoWithBase(t, { "src/app.ts": "versión base\n" });

    await repo.write("src/app.ts", "versión del PR\n");
    await repo.commit("cambia app");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["src/app.ts"]);
    t.after(() => base.cleanup());

    assert.deepEqual(base.files, ["src/app.ts"]);
    assert.equal(await readFile(join(base.dir, "src/app.ts"), "utf8"), "versión base\n");
  });

  test("leaves out the files the pull request added, which have no base version", async (t) => {
    const repo = await repoWithBase(t, { "src/viejo.ts": "uno\n" });

    await repo.write("src/nuevo.ts", "dos\n");
    await repo.commit("añade nuevo");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["src/viejo.ts", "src/nuevo.ts"]);
    t.after(() => base.cleanup());

    assert.deepEqual(base.files, ["src/viejo.ts"]);
    assert.equal(await exists(join(base.dir, "src/nuevo.ts")), false);
  });

  test("extracts nothing when every file is new, and still hands back a directory", async (t) => {
    const repo = await repoWithBase(t, { "src/viejo.ts": "uno\n" });

    await repo.write("src/nuevo.ts", "dos\n");
    await repo.commit("añade nuevo");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["src/nuevo.ts"]);
    t.after(() => base.cleanup());

    assert.deepEqual(base.files, []);
    assert.ok(await exists(base.dir));
  });

  test("only materializes what it was asked for, not the whole repository", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n", "b.ts": "dos\n" });

    await repo.write("a.ts", "uno cambiado\n");
    await repo.commit("cambia a");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["a.ts"]);
    t.after(() => base.cleanup());

    assert.equal(await exists(join(base.dir, "a.ts")), true);
    assert.equal(await exists(join(base.dir, "b.ts")), false);
  });

  test("keeps the directories the files live in", async (t) => {
    const repo = await repoWithBase(t, { "src/main/java/Order.java": "class Order {}\n" });

    await repo.write("src/main/java/Order.java", "class Order { int x; }\n");
    await repo.commit("cambia Order");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["src/main/java/Order.java"]);
    t.after(() => base.cleanup());

    assert.equal(await readFile(join(base.dir, "src/main/java/Order.java"), "utf8"), "class Order {}\n");
  });

  test("handles a path with spaces and non-ASCII characters", async (t) => {
    const repo = await repoWithBase(t, { "src/con espacios/año.ts": "base\n" });

    await repo.write("src/con espacios/año.ts", "cambiado\n");
    await repo.commit("cambia la ruta rara");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["src/con espacios/año.ts"]);
    t.after(() => base.cleanup());

    assert.deepEqual(base.files, ["src/con espacios/año.ts"]);
    assert.equal(await readFile(join(base.dir, "src/con espacios/año.ts"), "utf8"), "base\n");
  });

  test("leaves nothing behind once it is cleaned up", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.write("a.ts", "dos\n");
    await repo.commit("cambia a");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["a.ts"]);

    assert.equal(await exists(base.dir), true);
    await base.cleanup();
    assert.equal(await exists(base.dir), false);
  });

  test("can be cleaned up twice without failing", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    const base = await extractBaseVersion(repo.dir, "HEAD", ["a.ts"]);

    await base.cleanup();
    await base.cleanup();
  });

  test("does not touch the clone it read from", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.write("a.ts", "dos\n");
    await repo.commit("cambia a");

    const base = await extractBaseVersion(repo.dir, "HEAD~1", ["a.ts"]);
    t.after(() => base.cleanup());

    assert.equal(await readFile(join(repo.dir, "a.ts"), "utf8"), "dos\n");
    assert.equal((await repo.git("status", "--porcelain")).trim(), "");
  });
});
