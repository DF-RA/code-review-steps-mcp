import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { changedLinesByFile } from "../../src/analysis/changed-lines.js";
import { createTempRepo, numberedLines } from "../helpers/repo.js";

describe("changedLinesByFile", () => {
  test("returns nothing for an empty diff", () => {
    assert.equal(changedLinesByFile("").size, 0);
  });

  test("expands a hunk into every line it covers", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -12,3 +14,5 @@",
      "+one",
      "+two",
    ].join("\n");

    assert.deepEqual(changedLinesByFile(diff).get("src/app.ts"), new Set([14, 15, 16, 17, 18]));
  });

  test("reads an omitted count as a single line", () => {
    const diff = ["diff --git a/a.ts b/a.ts", "@@ -3 +7 @@", "+one"].join("\n");

    assert.deepEqual(changedLinesByFile(diff).get("a.ts"), new Set([7]));
  });

  test("attributes no line to a hunk that only deletes", () => {
    const diff = ["diff --git a/a.ts b/a.ts", "@@ -3,2 +2,0 @@", "-gone"].join("\n");

    assert.deepEqual(changedLinesByFile(diff).get("a.ts"), new Set());
  });

  test("keeps each file apart and merges its hunks", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,0 +1,2 @@",
      "+one",
      "+two",
      "@@ -10,0 +20,1 @@",
      "+three",
      "diff --git a/b.ts b/b.ts",
      "@@ -5,1 +5,1 @@",
      "-old",
      "+new",
    ].join("\n");

    const byFile = changedLinesByFile(diff);

    assert.deepEqual([...byFile.keys()], ["a.ts", "b.ts"]);
    assert.deepEqual(byFile.get("a.ts"), new Set([1, 2, 20]));
    assert.deepEqual(byFile.get("b.ts"), new Set([5]));
  });

  test("takes the path from the new side of a rename", () => {
    const diff = [
      "diff --git a/old/name.ts b/new/name.ts",
      "similarity index 90%",
      "rename from old/name.ts",
      "rename to new/name.ts",
      "@@ -1,0 +1,1 @@",
      "+one",
    ].join("\n");

    const byFile = changedLinesByFile(diff);

    assert.deepEqual([...byFile.keys()], ["new/name.ts"]);
    assert.deepEqual(byFile.get("new/name.ts"), new Set([1]));
  });

  test("ignores hunk headers that appear before any file header", () => {
    assert.equal(changedLinesByFile("@@ -1,1 +1,1 @@\n+stray").size, 0);
  });

  test("reads the hunks of a real git diff", async (t) => {
    const repo = await createTempRepo();

    t.after(() => repo.cleanup());

    await repo.write("src/app.ts", numberedLines(10));
    await repo.commit("base");

    await repo.write("src/app.ts", `${numberedLines(3)}inserted\n${numberedLines(7, 3)}`);
    await repo.commit("insert one line after the third");

    const diff = await repo.git("diff", "--unified=0", "HEAD~1...HEAD");

    assert.deepEqual(changedLinesByFile(diff).get("src/app.ts"), new Set([4]));
  });
});
