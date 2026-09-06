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
  test("returns the session that was created", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    assert.equal(requireSession(session.id), session);
  });

  test("tolerates an id the client padded with whitespace", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    assert.equal(requireSession(`  ${session.id}\n`), session);
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
    assert.equal(requireSession("imported-1"), restored);
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

describe("the session cache", () => {
  test("a session left unused for four hours leaves the cache but not the review", (t) => {
    useTempDb(t);
    t.mock.timers.enable({ apis: ["Date"], now: 0 });

    const old = createSession(sessionData({ files: [] }));

    t.mock.timers.tick(FOUR_HOURS_MS + 1);

    // Pruning happens when a session is stored, not when one is read.
    createSession(otherReview(2));

    const back = requireSession(old.id);

    // The review survives in the database; what the later steps had does not.
    assert.equal(back.prNumber, old.prNumber);
    assert.equal(back.files, undefined);
  });

  test("reading a session keeps it: idle time counts, not age", (t) => {
    useTempDb(t);
    t.mock.timers.enable({ apis: ["Date"], now: 0 });

    const waiting = createSession(sessionData({ files: [] }));

    // Someone reads the draft for hours: the review is in use, not abandoned.
    for (let hour = 0; hour < 6; hour += 1) {
      t.mock.timers.tick(FOUR_HOURS_MS / 2);
      requireSession(waiting.id);
    }

    createSession(otherReview(2));

    assert.equal(requireSession(waiting.id), waiting);
  });

  test("brings step 2 back when it rebuilds a session from the database", (t) => {
    useTempDb(t);

    const session = createSession(sessionData());

    saveTaskContext(session.id, { found: true, code: "PROJ-1234", summary: "Lo que pide." });

    // Evicting it is what a restart looks like from in here.
    for (let n = 0; n < 20; n += 1) {
      createSession(otherReview(n));
    }

    const back = requireSession(session.id);

    assert.notEqual(back, session);
    assert.equal(back.taskContext?.code, "PROJ-1234");
    assert.equal(back.taskContext?.summary, "Lo que pide.");
  });

  test("evicts the least recently used once it is full, and rebuilds it from the row", (t) => {
    useTempDb(t);

    const first = createSession(otherReview(1000));

    // Twice the capacity, so it does not matter how full the cache already was
    // when this test started: nothing older than these survives.
    for (let n = 0; n < 40; n += 1) {
      createSession(otherReview(n));
    }

    const back = requireSession(first.id);

    assert.notEqual(back, first);
    assert.equal(back.prNumber, first.prNumber);
    assert.equal(back.headRefOid, first.headRefOid);
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
