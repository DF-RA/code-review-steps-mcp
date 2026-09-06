import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  findReviewByHead,
  findReviewById,
  findReviewsOfPr,
  findTaskContext,
  saveReview,
  saveTaskContext,
} from "../../src/review/db.js";
import { useTempDb } from "../helpers/db.js";
import { sessionData } from "../helpers/session.js";

function stored(overrides: Parameters<typeof sessionData>[0] = {}, id = "r1") {
  return { ...sessionData(overrides), id, createdAt: Date.now() };
}

describe("the review store", () => {
  test("gives back what it was given", (t) => {
    useTempDb(t);

    const review = stored();
    saveReview(review);

    assert.deepEqual(findReviewById("r1"), review);
  });

  test("does not know an id nobody stored", (t) => {
    useTempDb(t);

    assert.equal(findReviewById("nope"), undefined);
  });

  test("survives the connection: that is the point of the file", (t) => {
    const file = useTempDb(t);
    saveReview(stored());

    // closeDb + the same path is what a restart looks like from here.
    process.env.CODE_REVIEW_MCP_DB = file;

    assert.equal(findReviewById("r1")?.prNumber, 200);
  });

  test("updates in place when the same id comes back", (t) => {
    useTempDb(t);

    saveReview(stored());
    saveReview(stored({ title: "Otro título" }));

    assert.equal(findReviewById("r1")?.title, "Otro título");
  });
});

describe("finding the review of a head", () => {
  test("finds the review of that exact clone, pull request and head", (t) => {
    useTempDb(t);

    saveReview(stored());

    const found = findReviewByHead("/home/me/clones/tienda", 200, "b".repeat(40));

    assert.equal(found?.id, "r1");
  });

  test("does not answer for a head that was never reviewed", (t) => {
    useTempDb(t);

    saveReview(stored());

    assert.equal(findReviewByHead("/home/me/clones/tienda", 200, "c".repeat(40)), undefined);
  });

  test("keeps clones apart: the same PR number elsewhere is another review", (t) => {
    useTempDb(t);

    saveReview(stored());

    assert.equal(findReviewByHead("/otro/clon", 200, "b".repeat(40)), undefined);
  });

  test("refuses a second id for the same head", (t) => {
    useTempDb(t);

    saveReview(stored());

    assert.throws(() => saveReview(stored({}, "r2")), /Ya hay una revisión de ese head/u);
  });
});

describe("the earlier reviews of a pull request", () => {
  test("lists every head reviewed, newest first", (t) => {
    useTempDb(t);

    saveReview({ ...stored({ headRefOid: "a".repeat(40) }, "old"), createdAt: 1_000 });
    saveReview({ ...stored({ headRefOid: "b".repeat(40) }, "new"), createdAt: 2_000 });

    assert.deepEqual(
      findReviewsOfPr("/home/me/clones/tienda", 200).map((review) => review.id),
      ["new", "old"],
    );
  });

  test("is empty for a pull request nobody reviewed", (t) => {
    useTempDb(t);

    assert.deepEqual(findReviewsOfPr("/home/me/clones/tienda", 999), []);
  });
});

describe("the task context", () => {
  test("gives back what step 2 recorded", (t) => {
    useTempDb(t);
    saveReview(stored());

    const context = {
      found: true,
      code: "PROJ-1234",
      title: "Rechazo con items",
      summary: "Permitir rechazar indicando qué items se rechazan.",
      url: "https://tracker/PROJ-1234",
    };

    saveTaskContext("r1", context);

    assert.deepEqual(findTaskContext("r1"), { ...context, reason: undefined });
  });

  test("keeps found: false and its reason", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveTaskContext("r1", { found: false, reason: "el PR no referencia ninguna tarea" });

    const back = findTaskContext("r1");

    assert.equal(back?.found, false);
    assert.equal(back?.reason, "el PR no referencia ninguna tarea");
  });

  test("tells apart nobody looked from looked and found nothing", (t) => {
    useTempDb(t);
    saveReview(stored());

    // No row: step 2 has not run.
    assert.equal(findTaskContext("r1"), undefined);

    saveTaskContext("r1", { found: false, reason: "gestor no disponible" });

    // A row saying false: step 2 ran and there was no task.
    assert.equal(findTaskContext("r1")?.found, false);
  });

  test("recording it again corrects it instead of adding a second one", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveTaskContext("r1", { found: false, reason: "no encontrada" });
    saveTaskContext("r1", { found: true, code: "PROJ-9" });

    const back = findTaskContext("r1");

    assert.equal(back?.found, true);
    assert.equal(back?.code, "PROJ-9");
    assert.equal(back?.reason, undefined);
  });

  test("refuses a context whose review does not exist", (t) => {
    useTempDb(t);

    assert.throws(
      () => saveTaskContext("no-existe", { found: true, code: "PROJ-1" }),
      /FOREIGN KEY constraint failed/u,
    );
  });

  test("belongs to its review and not to another", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveReview(stored({ prNumber: 300, headRefOid: "c".repeat(40) }, "r2"));

    saveTaskContext("r1", { found: true, code: "PROJ-1" });

    assert.equal(findTaskContext("r1")?.code, "PROJ-1");
    assert.equal(findTaskContext("r2"), undefined);
  });
});
