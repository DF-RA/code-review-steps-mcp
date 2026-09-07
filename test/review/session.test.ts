import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { UserFacingError } from "../../src/errors.js";
import {
  adoptSession,
  createSession,
  requireAnalysis,
  requireFiles,
  requireSession,
  requireTaskContext,
  restartSteps,
} from "../../src/review/session.js";
import { saveTaskContext } from "../../src/review/db.js";
import { useTempDb } from "../helpers/db.js";
import { sessionData } from "../helpers/session.js";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** Reviews are unique per clone, pull request and head: vary one to get another. */
function otherReview(n: number): ReturnType<typeof sessionData> {
  return sessionData({ prNumber: n, headRefOid: String(n).padStart(40, "0") });
}

describe("createSession", () => {
  test("gives the session an id and a creation time", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    assert.match(session.id, /^[0-9a-f-]{36}$/u);
    assert.ok(session.createdAt <= Date.now());
  });

  test("keeps everything it was given", (t) => {
    useTempDb(t);

    const session = createSession(sessionData({ prNumber: 7 }));

    assert.equal(session.prNumber, 7);
    assert.equal(session.range, `${"a".repeat(40)}...${"b".repeat(40)}`);
  });

  test("gives every session its own id", (t) => {
    useTempDb(t);

    assert.notEqual(createSession(otherReview(1)).id, createSession(otherReview(2)).id);
  });

  test("refuses a second review of the very same head", (t) => {
    useTempDb(t);

    const first = createSession(sessionData());

    assert.throws(() => createSession(sessionData()), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, new RegExp(first.id, "u"));
      return true;
    });
  });
});

describe("requireSession", () => {
  test("returns the review that was created", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());
    const back = requireSession(session.id);

    assert.equal(back.id, session.id);
    assert.equal(back.prNumber, session.prNumber);
    assert.equal(back.range, session.range);
  });

  test("builds a fresh view each time instead of sharing one object", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());
    const first = requireSession(session.id);

    first.title = "cambiado a mano";

    // Without a cache, touching what one call returned cannot reach the next.
    assert.equal(requireSession(session.id).title, session.title);
  });

  test("tolerates an id the client padded with whitespace", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    assert.equal(requireSession(`  ${session.id}\n`).id, session.id);
  });

  test("says how to start over when the id is unknown", (t) => {
    useTempDb(t);

    assert.throws(() => requireSession("nope"), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /No hay ninguna revisión con id "nope"/u);
      assert.match(error.message, /start_review/u);
      return true;
    });
  });
});

describe("adoptSession", () => {
  test("puts a restored session back into play under its own id", (t) => {
    useTempDb(t);

    const restored = { ...sessionData(), id: "imported-1", createdAt: Date.now() };

    assert.equal(adoptSession(restored), restored);
    assert.equal(requireSession("imported-1").prNumber, restored.prNumber);
  });

  test("replaces a session already held under that id", (t) => {
    useTempDb(t);

    const first = { ...sessionData(), id: "same", createdAt: Date.now() };
    const second = { ...sessionData({ prNumber: 999 }), id: "same", createdAt: Date.now() };

    adoptSession(first);
    adoptSession(second);

    assert.equal(requireSession("same").prNumber, 999);
  });
});

describe("without a cache", () => {
  test("a review does not expire, however long it sits", (t) => {
    useTempDb(t);
    t.mock.timers.enable({ apis: ["Date"], now: 0 });

    const session = createSession(sessionData());

    // Step 7 tells the agent to stop and wait for a person, for as long as it
    // takes. Nothing may throw the review away in the meantime.
    t.mock.timers.tick(FOUR_HOURS_MS * 100);

    assert.equal(requireSession(session.id).id, session.id);
  });

  test("opening more reviews does not push the older ones out", (t) => {
    useTempDb(t);

    const first = createSession(otherReview(1000));

    for (let n = 0; n < 40; n += 1) {
      createSession(otherReview(n));
    }

    assert.equal(requireSession(first.id).id, first.id);
  });

  test("brings back what the steps recorded, not only the review", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    saveTaskContext(session.id, { found: true, code: "PROJ-1234", summary: "Lo que pide." });

    const back = requireSession(session.id);

    assert.equal(back.taskContext?.code, "PROJ-1234");
    assert.equal(back.taskContext?.summary, "Lo que pide.");
  });
});

describe("restartSteps", () => {
  test("empties the live session too, not only the rows", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    saveTaskContext(session.id, { found: true, code: "PROJ-1" });
    session.taskContext = { found: true, code: "PROJ-1" };
    session.files = [];
    session.analysis = { tools: [], skipped: [], findingsByFile: new Map(), unanalyzed: [] };
    session.draft = { comments: [], confirmed: false, createdAt: 1 };

    restartSteps(session);

    assert.equal(session.taskContext, undefined);
    assert.equal(session.files, undefined);
    assert.equal(session.analysis, undefined);
    assert.equal(session.draft, undefined);
  });

  test("leaves the session findable under the same id", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    restartSteps(session);

    assert.equal(requireSession(session.id).id, session.id);
  });
});

describe("the step guards", () => {
  test("requireTaskContext points at the prompt and at recording the answer", (t) => {
    useTempDb(t);

    assert.throws(() => requireTaskContext(createSession(sessionData())), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /task_context/u);
      assert.match(error.message, /record_task_context/u);
      return true;
    });
  });

  test("requireTaskContext returns the context once it is there, absent task included", (t) => {
    useTempDb(t);

    const session = createSession(sessionData({ taskContext: { found: false, reason: "sin código" } }));

    assert.deepEqual(requireTaskContext(session), { found: false, reason: "sin código" });
  });

  test("requireFiles points at get_pr_files", (t) => {
    useTempDb(t);

    assert.throws(() => requireFiles(createSession(sessionData())), /get_pr_files/u);
  });

  test("requireFiles accepts an empty list: a PR that touches nothing is answered, not missing", (t) => {
    useTempDb(t);

    assert.deepEqual(requireFiles(createSession(sessionData({ files: [] }))), []);
  });

  test("requireAnalysis points at analyze_pr", (t) => {
    useTempDb(t);

    assert.throws(() => requireAnalysis(createSession(sessionData())), /analyze_pr/u);
  });

  test("requireAnalysis returns the analysis once it is there", (t) => {
    useTempDb(t);

    const analysis = { tools: ["ESLint"], skipped: [], findingsByFile: new Map(), unanalyzed: [] };

    assert.equal(requireAnalysis(createSession(sessionData({ analysis }))), analysis);
  });
});
