import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DRAFT_STATUSES,
  countByStatus,
  renderDraftComment,
  toDraftComment,
  type Draft,
  type DraftComment,
} from "../../src/draft/draft.js";
import { renderComment, type ReviewComment } from "../../src/review/comments.js";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    scope: "line",
    path: "src/app.ts",
    line: 12,
    endLine: 14,
    severity: "issue",
    title: "Título",
    body: "Cuerpo.",
    ...overrides,
  };
}

function draft(comments: DraftComment[]): Draft {
  return { comments, confirmed: false, createdAt: Date.now() };
}

describe("toDraftComment", () => {
  test("starts every comment pending and unedited", () => {
    const drafted = toDraftComment(comment(), "c1");

    assert.equal(drafted.status, "pending");
    assert.equal(drafted.edited, false);
    assert.equal(drafted.id, "c1");
  });

  test("carries the anchor of the comment across", () => {
    const drafted = toDraftComment(comment(), "c1");

    assert.deepEqual(
      { scope: drafted.scope, path: drafted.path, line: drafted.line, endLine: drafted.endLine },
      { scope: "line", path: "src/app.ts", line: 12, endLine: 14 },
    );
  });

  test("leaves the anchor undefined for a comment that has none", () => {
    const drafted = toDraftComment(comment({ scope: "pr", path: undefined, line: undefined, endLine: undefined }), "c1");

    assert.equal(drafted.path, undefined);
    assert.equal(drafted.line, undefined);
  });

  test("does not carry over who raised it: the draft is what gets published", () => {
    const drafted = toDraftComment(comment({ raisedBy: "qa" }), "c1");

    assert.equal("raisedBy" in drafted, false);
  });
});

describe("renderDraftComment", () => {
  test("renders exactly what renderComment would, so the preview is the real thing", () => {
    assert.equal(renderDraftComment(toDraftComment(comment(), "c1")), renderComment(comment()));
  });

  test("publishes the edited body, not the original one", () => {
    const drafted = { ...toDraftComment(comment(), "c1"), body: "Cuerpo reescrito.", edited: true };

    assert.match(renderDraftComment(drafted), /> Cuerpo reescrito\./u);
    assert.doesNotMatch(renderDraftComment(drafted), /Cuerpo\./u);
  });

  test("does not leak the draft bookkeeping into the published text", () => {
    const drafted = { ...toDraftComment(comment(), "c1"), status: "rework" as const, note: "Suaviza el tono" };

    assert.doesNotMatch(renderDraftComment(drafted), /Suaviza el tono|rework|c1/u);
  });
});

describe("countByStatus", () => {
  test("reports a zero for every status on an empty draft", () => {
    assert.deepEqual(countByStatus(draft([])), { pending: 0, valid: 0, discarded: 0, rework: 0 });
  });

  test("counts one bucket per status", () => {
    const comments = DRAFT_STATUSES.flatMap((status, index) =>
      Array.from({ length: index + 1 }, (_, n) => ({
        ...toDraftComment(comment(), `${status}-${n}`),
        status,
      })),
    );

    assert.deepEqual(countByStatus(draft(comments)), { pending: 1, valid: 2, discarded: 3, rework: 4 });
  });
});
