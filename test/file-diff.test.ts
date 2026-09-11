import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { UserFacingError } from "../src/errors.js";
import { fileDiff } from "../src/file-diff.js";
import { createTempRepo, numberedLines, type TempRepo } from "./helpers/repo.js";

const RANGE = "HEAD~1...HEAD";

/** Lines that differ from `numberedLines`, to force a rewritten block. */
function rewritten(count: number, offset = 0): string {
  return `${Array.from({ length: count }, (_, index) => `otra ${index + 1 + offset}`).join("\n")}\n`;
}

async function repoWithBase(
  t: { after(fn: () => unknown): void },
  content: string,
): Promise<TempRepo> {
  const repo = await createTempRepo();

  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", content);
  await repo.commit("base");

  return repo;
}

describe("fileDiff", () => {
  test("returns the diff of the file with its header", async (t) => {
    const repo = await repoWithBase(t, numberedLines(10));

    await repo.write("src/app.ts", `${numberedLines(3)}insertada\n${numberedLines(7, 3)}`);
    await repo.commit("inserta una línea");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.equal(result.path, "src/app.ts");
    assert.match(result.diff, /^diff --git a\/src\/app\.ts b\/src\/app\.ts$/mu);
    assert.match(result.diff, /^\+insertada$/mu);
  });

  test("reports one part when the whole diff fits", async (t) => {
    const repo = await repoWithBase(t, numberedLines(10));

    await repo.write("src/app.ts", `${numberedLines(3)}insertada\n${numberedLines(7, 3)}`);
    await repo.commit("inserta una línea");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.deepEqual(
      { offset: result.offset, hunksIncluded: result.hunksIncluded, totalHunks: result.totalHunks },
      { offset: 0, hunksIncluded: 1, totalHunks: 1 },
    );
    assert.equal(result.hasMore, false);
    assert.equal(result.nextOffset, undefined);
  });

  test("counts every hunk of the file", async (t) => {
    const repo = await repoWithBase(t, numberedLines(300));

    // Three edits far enough apart that git cannot merge their context.
    const lines = numberedLines(300).split("\n");
    lines[0] = "cambiada 1";
    lines[150] = "cambiada 151";
    lines[299 - 1] = "cambiada 299";

    await repo.write("src/app.ts", lines.join("\n"));
    await repo.commit("tres cambios lejanos");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.equal(result.totalHunks, 3);
    assert.equal(result.hunksIncluded, 3);
    assert.equal(result.hasMore, false);
  });

  test("cuts at a hunk boundary once the line budget is spent", async (t) => {
    const repo = await repoWithBase(t, `${numberedLines(600)}${"separador\n".repeat(20)}${numberedLines(600, 600)}`);

    await repo.write("src/app.ts", `${rewritten(600)}${"separador\n".repeat(20)}${rewritten(600, 600)}`);
    await repo.commit("reescribe los dos bloques");

    const first = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.equal(first.totalHunks, 2);
    assert.equal(first.hunksIncluded, 1);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffset, 1);
  });

  test("walks the rest of the diff from the offset it handed back", async (t) => {
    const repo = await repoWithBase(t, `${numberedLines(600)}${"separador\n".repeat(20)}${numberedLines(600, 600)}`);

    await repo.write("src/app.ts", `${rewritten(600)}${"separador\n".repeat(20)}${rewritten(600, 600)}`);
    await repo.commit("reescribe los dos bloques");

    const first = await fileDiff(repo.dir, RANGE, "src/app.ts");
    const second = await fileDiff(repo.dir, RANGE, "src/app.ts", first.nextOffset);

    assert.equal(second.offset, 1);
    assert.equal(second.hunksIncluded, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextOffset, undefined);
  });

  test("repeats the file header in every part, so a part reads on its own", async (t) => {
    const repo = await repoWithBase(t, `${numberedLines(600)}${"separador\n".repeat(20)}${numberedLines(600, 600)}`);

    await repo.write("src/app.ts", `${rewritten(600)}${"separador\n".repeat(20)}${rewritten(600, 600)}`);
    await repo.commit("reescribe los dos bloques");

    const second = await fileDiff(repo.dir, RANGE, "src/app.ts", 1);

    assert.match(second.diff, /^diff --git a\/src\/app\.ts b\/src\/app\.ts$/mu);
    assert.match(second.diff, /^\+\+\+ b\/src\/app\.ts$/mu);
  });

  test("splits nothing that the two parts do not cover between them", async (t) => {
    const repo = await repoWithBase(t, `${numberedLines(600)}${"separador\n".repeat(20)}${numberedLines(600, 600)}`);

    await repo.write("src/app.ts", `${rewritten(600)}${"separador\n".repeat(20)}${rewritten(600, 600)}`);
    await repo.commit("reescribe los dos bloques");

    const whole = await repo.git("diff", RANGE, "--", "src/app.ts");
    const first = await fileDiff(repo.dir, RANGE, "src/app.ts");
    const second = await fileDiff(repo.dir, RANGE, "src/app.ts", 1);

    const hunkLines = (diff: string) => diff.split("\n").filter((line) => line.startsWith("@@")).length;

    assert.equal(hunkLines(first.diff) + hunkLines(second.diff), hunkLines(whole));
  });

  test("sends a hunk bigger than the budget whole, so the walk cannot stall", async (t) => {
    const repo = await repoWithBase(t, numberedLines(3000));

    await repo.write("src/app.ts", rewritten(3000));
    await repo.commit("reescribe el archivo entero");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.equal(result.totalHunks, 1);
    assert.equal(result.hunksIncluded, 1);
    assert.equal(result.hasMore, false);
    assert.ok(result.diff.split("\n").length > 2000);
  });

  test("keeps a blank context line, which is a single space and not an empty one", async (t) => {
    const repo = await repoWithBase(t, "uno\n\ndos\n");

    await repo.write("src/app.ts", "uno\n\ndos cambiado\n");
    await repo.commit("cambia después de una línea en blanco");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.ok(result.diff.split("\n").includes(" "), "the blank context line was trimmed away");
  });

  test("says the range shows no changes for a file it does not touch", async (t) => {
    const repo = await repoWithBase(t, numberedLines(10));

    await repo.write("otro.ts", "uno\n");
    await repo.commit("toca otro archivo");

    await assert.rejects(fileDiff(repo.dir, RANGE, "src/app.ts"), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /no muestra cambios en "src\/app\.ts"/u);
      return true;
    });
  });

  test("says how many parts there really are when the offset is past the end", async (t) => {
    const repo = await repoWithBase(t, numberedLines(10));

    await repo.write("src/app.ts", `${numberedLines(3)}insertada\n${numberedLines(7, 3)}`);
    await repo.commit("inserta una línea");

    await assert.rejects(fileDiff(repo.dir, RANGE, "src/app.ts", 5), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /solo tiene 1 bloque\(s\).*posición 5/u);
      return true;
    });
  });

  test("does not read the path as a ref, even when a branch shares its name", async (t) => {
    const repo = await repoWithBase(t, numberedLines(10));

    await repo.write("src/app.ts", `${numberedLines(3)}insertada\n${numberedLines(7, 3)}`);
    await repo.commit("inserta una línea");
    await repo.git("branch", "src/app.ts", "HEAD");

    const result = await fileDiff(repo.dir, RANGE, "src/app.ts");

    assert.match(result.diff, /^\+insertada$/mu);
  });
});
