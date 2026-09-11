import assert from "node:assert/strict";
import { rm, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import { listChangedFiles, pathId, type ChangedFile, type ChangeStatus } from "../src/changed-files.js";
import { createTempRepo, type TempRepo } from "./helpers/repo.js";

/** The shape expected back, with the id the parser derives from the path. */
function file(path: string, status: ChangeStatus, previousPath?: string): ChangedFile {
  return { pathId: pathId(path), path, status, ...(previousPath ? { previousPath } : {}) };
}

/** A clone with a base commit, ready for the pull request commit on top. */
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

const RANGE = "HEAD~1...HEAD";

describe("listChangedFiles", () => {
  test("returns nothing when the range has no changes", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.git("commit", "--quiet", "--allow-empty", "--message", "vacío");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), []);
  });

  test("reports an added file", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.write("b.ts", "dos\n");
    await repo.commit("añade b");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [file("b.ts", "added")]);
  });

  test("reports a modified file", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.write("a.ts", "uno y medio\n");
    await repo.commit("toca a");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [file("a.ts", "modified")]);
  });

  test("reports a deleted file", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n", "b.ts": "dos\n" });

    await rm(join(repo.dir, "b.ts"));
    await repo.commit("borra b");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [file("b.ts", "deleted")]);
  });

  test("reports a rename with the path it came from", async (t) => {
    const repo = await repoWithBase(t, { "viejo.ts": "contenido con cuerpo suficiente\n".repeat(5) });

    await repo.git("mv", "viejo.ts", "nuevo.ts");
    await repo.commit("renombra");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [
      file("nuevo.ts", "renamed", "viejo.ts"),
    ]);
  });

  test("reports a file that turned into a symlink", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n", "enlace.ts": "dos\n" });

    await unlink(join(repo.dir, "enlace.ts"));
    await symlink("a.ts", join(repo.dir, "enlace.ts"));
    await repo.commit("convierte en enlace");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [
      file("enlace.ts", "type-changed"),
    ]);
  });

  test("reads paths with spaces and non-ASCII characters whole", async (t) => {
    // The -z form is what keeps git from quoting these; without it the path
    // would come back wrapped in quotes and with escapes.
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.write("src/con espacios/año ñ.ts", "dos\n");
    await repo.commit("añade rutas raras");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [
      file("src/con espacios/año ñ.ts", "added"),
    ]);
  });

  test("reports every file of the range, in one call", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n", "b.ts": "dos\n" });

    await repo.write("a.ts", "uno cambiado\n");
    await rm(join(repo.dir, "b.ts"));
    await repo.write("c.ts", "tres\n");
    await repo.commit("varios cambios");

    assert.deepEqual(await listChangedFiles(repo.dir, RANGE), [
      file("a.ts", "modified"),
      file("b.ts", "deleted"),
      file("c.ts", "added"),
    ]);
  });

  test("compares against the merge base, not against the tip of the branch", async (t) => {
    const repo = await repoWithBase(t, { "a.ts": "uno\n" });

    await repo.git("checkout", "--quiet", "-b", "feature");
    await repo.write("feature.ts", "de la rama\n");
    await repo.commit("cambio de la rama");

    await repo.git("checkout", "--quiet", "main");
    await repo.write("main.ts", "de main\n");
    await repo.commit("cambio de main que llegó después");

    // main.ts landed on main after the branch started: it is not of the PR.
    assert.deepEqual(await listChangedFiles(repo.dir, "main...feature"), [
      file("feature.ts", "added"),
    ]);
  });
});
