import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { textOf } from "../../src/draft/highlight.js";
import { snippetFor } from "../../src/draft/snippet.js";
import { createTempRepo, type TempRepo } from "../helpers/repo.js";

/** Forty numbered lines: enough for two hunks that do not touch each other. */
function numbered(): string {
  return `${Array.from({ length: 40 }, (_, index) => `linea ${String(index + 1).padStart(2, "0")}`).join("\n")}\n`;
}

describe("snippetFor", () => {
  let repo: TempRepo;
  let diff: string;

  before(async () => {
    repo = await createTempRepo();

    await repo.write("src/app.ts", numbered());
    await repo.commit("base");
    const base = (await repo.git("rev-parse", "HEAD")).trim();

    // One change near the top and another far below, so the diff has two hunks
    // and the second one moves the numbering of the new side.
    const lines = numbered().split("\n");
    lines[5] = "linea 06 cambiada";
    lines.splice(29, 1);

    await repo.write("src/app.ts", lines.join("\n"));
    await repo.commit("cambios");
    const head = (await repo.git("rev-parse", "HEAD")).trim();

    diff = await repo.git("diff", `${base}...${head}`, "--", "src/app.ts");
  });

  after(async () => {
    await repo.cleanup();
  });

  test("cuts the hunk around the line and marks the one commented on", () => {
    const snippet = snippetFor(diff, "src/app.ts", 6);

    assert.ok(snippet);
    const targets = snippet.lines.filter((line) => line.target);

    assert.equal(targets.length, 1);
    assert.equal(textOf(targets[0]?.tokens ?? []), "linea 06 cambiada");
    assert.equal(targets[0]?.kind, "added");
    assert.equal(targets[0]?.number, 6);
  });

  test("keeps the context of the hunk around it", () => {
    const snippet = snippetFor(diff, "src/app.ts", 6);
    const context = snippet?.lines.filter((line) => line.kind === "context") ?? [];

    assert.deepEqual(
      context.map((line) => line.number),
      [3, 4, 5, 7, 8, 9],
    );
  });

  test("shows the removed line, which has no number on the new side", () => {
    const snippet = snippetFor(diff, "src/app.ts", 6);
    const removed = snippet?.lines.filter((line) => line.kind === "removed") ?? [];

    assert.equal(removed.length, 1);
    assert.equal(textOf(removed[0]?.tokens ?? []), "linea 06");
    assert.equal(removed[0]?.number, undefined);
    // It is context for the comment, not the line the comment points at.
    assert.equal(removed[0]?.target, false);
  });

  test("numbers on the new side, which is where the comment is anchored", () => {
    // Line 30 of the file after the deletion is "linea 31" of the original.
    const snippet = snippetFor(diff, "src/app.ts", 30);
    const target = snippet?.lines.find((line) => line.target);

    assert.equal(textOf(target?.tokens ?? []), "linea 31");
    assert.equal(target?.number, 30);
  });

  test("cuts from the hunk that holds the line, not from the first one", () => {
    const snippet = snippetFor(diff, "src/app.ts", 30);
    const numbers = snippet?.lines.map((line) => line.number).filter((n) => n !== undefined) ?? [];

    assert.ok(Math.min(...numbers) >= 27, `empieza en ${Math.min(...numbers)}`);
  });

  test("marks every line of a range", () => {
    const snippet = snippetFor(diff, "src/app.ts", 5, 7);
    const targets = snippet?.lines.filter((line) => line.target) ?? [];

    assert.deepEqual(
      targets.map((line) => line.number),
      [5, 6, 7],
    );
  });

  test("says a line the PR changed can carry the comment", () => {
    assert.equal(snippetFor(diff, "src/app.ts", 6)?.anchored, true);
  });

  test("says a context line cannot, which is what publish_review will do with it", () => {
    // Line 4 is inside the hunk but the PR does not change it: GitHub would
    // refuse an inline comment there, so it ends up as a file comment.
    const snippet = snippetFor(diff, "src/app.ts", 4);

    assert.ok(snippet, "hay código que enseñar");
    assert.equal(snippet.anchored, false);
  });

  test("gives nothing for a line the pull request does not touch", () => {
    // That comment is the one publish_review turns into a file comment: there
    // is no hunk to cut, and inventing one would be a lie.
    assert.equal(snippetFor(diff, "src/app.ts", 15), undefined);
  });

  test("gives nothing when the file has no diff at all", () => {
    assert.equal(snippetFor("", "src/app.ts", 6), undefined);
  });

  test("takes the context asked for", () => {
    const snippet = snippetFor(diff, "src/app.ts", 6, undefined, 1);
    const context = snippet?.lines.filter((line) => line.kind === "context") ?? [];

    assert.deepEqual(
      context.map((line) => line.number),
      [5, 7],
    );
  });
});

describe("snippetFor, on what git writes around the lines", () => {
  test("keeps an empty context line, which is a line of the file", () => {
    const diff = ["@@ -1,3 +1,3 @@", " uno", "", "-tres", "+TRES"].join("\n");
    const snippet = snippetFor(diff, "src/app.ts", 3);

    assert.deepEqual(
      snippet?.lines.map((line) => `${line.kind}:${textOf(line.tokens)}`),
      ["context:uno", "context:", "removed:tres", "added:TRES"],
    );
  });

  test("drops the note about the missing newline: it is not a line of the file", () => {
    const diff = ["@@ -1,2 +1,2 @@", " uno", "-dos", "+DOS", "\\ No newline at end of file"].join("\n");

    assert.deepEqual(
      snippetFor(diff, "src/app.ts", 2)?.lines.map((line) => textOf(line.tokens)),
      ["uno", "dos", "DOS"],
    );
  });

  test("does not hang an empty line under the hunk", () => {
    // The diff ends with a newline; splitting on it leaves a last empty string
    // that is the end of the text, not a line of the file.
    const diff = `${["@@ -1,2 +1,2 @@", " uno", "-dos", "+DOS"].join("\n")}\n`;

    assert.deepEqual(
      snippetFor(diff, "src/app.ts", 2)?.lines.map((line) => textOf(line.tokens)),
      ["uno", "dos", "DOS"],
    );
  });

  test("cuts a range longer than the card and says it was cut", () => {
    const body = Array.from({ length: 60 }, (_, index) => `+linea ${index + 1}`);
    const diff = ["@@ -0,0 +1,60 @@", ...body].join("\n");
    const snippet = snippetFor(diff, "src/app.ts", 1, 60);

    assert.ok(snippet);
    assert.equal(snippet.truncated, true);
    assert.equal(snippet.lines.length, 40);
  });
});
