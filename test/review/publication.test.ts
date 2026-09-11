import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { DraftComment } from "../../src/draft/draft.js";
import { buildPublication } from "../../src/review/publication.js";

function comment(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: "c1",
    scope: "line",
    severity: "issue",
    path: "src/app.ts",
    line: 10,
    title: "Título",
    body: "Cuerpo",
    status: "valid",
    edited: false,
    ...overrides,
  };
}

const diff = (...lines: number[]): Map<string, Set<number>> =>
  new Map([["src/app.ts", new Set(lines)]]);

describe("buildPublication", () => {
  test("anchors a line comment to the diff, on the new side", () => {
    const { inline, files } = buildPublication([comment()], diff(9, 10, 11));

    assert.equal(files.length, 0);
    assert.equal(inline.length, 1);
    assert.equal(inline[0]?.path, "src/app.ts");
    assert.equal(inline[0]?.line, 10);
    assert.equal(inline[0]?.side, "RIGHT");
    assert.equal(inline[0]?.start_line, undefined);
  });

  test("sends a range when the diff touches all of it", () => {
    const { inline } = buildPublication(
      [comment({ line: 10, endLine: 12 })],
      diff(10, 11, 12),
    );

    assert.equal(inline[0]?.start_line, 10);
    assert.equal(inline[0]?.start_side, "RIGHT");
    assert.equal(inline[0]?.line, 12);
  });

  test("falls back to the first line when the range leaves the diff", () => {
    // GitHub takes a multi-line comment inside one hunk and no further: asking
    // for 10-12 with 11 untouched would be rejected, and with it the review.
    const { inline, files } = buildPublication(
      [comment({ line: 10, endLine: 12 })],
      diff(10, 12),
    );

    assert.equal(files.length, 0);
    assert.equal(inline[0]?.line, 10);
    assert.equal(inline[0]?.start_line, undefined);
  });

  test("never puts a file comment inside the review: GitHub rejects the lot", () => {
    const { inline, files } = buildPublication(
      [comment({ scope: "file", line: undefined })],
      diff(10),
    );

    assert.equal(inline.length, 0);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.path, "src/app.ts");
  });

  test("demotes a line the pull request does not touch, and says which", () => {
    const { inline, files, demoted } = buildPublication(
      [comment({ line: 42, title: "Fuera del diff" })],
      diff(10),
    );

    assert.equal(inline.length, 0);
    assert.equal(files.length, 1);
    assert.match(files[0]?.body ?? "", /no forma parte del diff/u);
    assert.deepEqual(demoted, ["src/app.ts L42 — Fuera del diff"]);
  });

  test("demotes a file the diff does not have at all", () => {
    const { inline, files } = buildPublication([comment()], new Map());

    assert.equal(inline.length, 0);
    assert.equal(files.length, 1);
  });

  test("takes a line comment with no line as one about the file", () => {
    const { inline, files } = buildPublication([comment({ line: undefined })], diff(10));

    assert.equal(inline.length, 0);
    assert.equal(files.length, 1);
  });

  test("puts pr comments in the body, and only those", () => {
    const { body, inline, files } = buildPublication(
      [
        comment({ scope: "pr", path: undefined, line: undefined, title: "Pipeline roja" }),
        comment({ id: "c2" }),
      ],
      diff(10),
    );

    assert.match(body, /^## Revisión automática/u);
    assert.match(body, /Pipeline roja/u);
    assert.equal(inline.length, 1);
    assert.equal(files.length, 0);
  });

  test("says where the comments are when the body carries none", () => {
    const { body } = buildPublication([comment()], diff(10));

    assert.match(body, /Los comentarios van en las líneas del diff/u);
  });

  test("treats a comment with no path as one about the pull request", () => {
    const { body, inline, files } = buildPublication(
      [comment({ path: undefined, title: "Sin archivo" })],
      diff(10),
    );

    assert.match(body, /Sin archivo/u);
    assert.equal(inline.length, 0);
    assert.equal(files.length, 0);
  });
});
