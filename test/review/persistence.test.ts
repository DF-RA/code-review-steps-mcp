import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, test } from "node:test";

import type { Finding } from "../../src/analysis/types.js";
import { pathId } from "../../src/changed-files.js";
import { UserFacingError } from "../../src/errors.js";
import type { ReviewComment } from "../../src/review/comments.js";
import {
  defaultPath,
  deserialize,
  readExport,
  serialize,
  writeExport,
} from "../../src/review/persistence.js";
import type { ReviewSession } from "../../src/review/session.js";
import { sessionData } from "../helpers/session.js";

const FINDING: Finding = {
  tool: "ESLint",
  path: "src/app.ts",
  line: 4,
  endLine: 4,
  rule: "no-unused-vars",
  severity: "medium",
  message: "Unused",
};

const COMMENT: ReviewComment = {
  scope: "line",
  path: "src/app.ts",
  line: 4,
  severity: "issue",
  title: "Título",
  body: "Cuerpo.",
};

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return { ...sessionData(), id: "review-1", createdAt: 1_700_000_000_000, ...overrides };
}

/** A session with every optional step filled in, Maps included. */
function fullSession(): ReviewSession {
  return session({
    files: [{ pathId: pathId("src/app.ts"), path: "src/app.ts", status: "modified" }],
    taskContext: { found: true, code: "PROJ-1", title: "Tarea" },
    fixes: [{ id: "f1", severity: "issue", title: "t", body: "b", status: "pending" }],
    draft: { comments: [], confirmed: false, createdAt: 1 },
    reviews: new Map([["src/app.ts", [COMMENT]]]),
    analysis: {
      tools: ["ESLint"],
      skipped: [{ tool: "PMD", reason: "no instalado" }],
      findingsByFile: new Map([["src/app.ts", [FINDING]]]),
      unanalyzed: ["docs/logo.png"],
    },
  });
}

async function tempDir(t: { after(fn: () => unknown): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "code-review-steps-export-"));

  t.after(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

describe("serialize", () => {
  test("writes a JSON document with the format version and when it was saved", () => {
    const stored = JSON.parse(serialize(session())) as { version: number; savedAt: string };

    assert.equal(stored.version, 1);
    assert.ok(!Number.isNaN(Date.parse(stored.savedAt)));
  });

  test("ends with a newline, so the file is a well-formed text file", () => {
    assert.ok(serialize(session()).endsWith("}\n"));
  });

  test("turns the Maps into pairs, which is what survives JSON", () => {
    const stored = JSON.parse(serialize(fullSession())) as {
      session: { reviews: unknown; analysis: { findingsByFile: unknown } };
    };

    assert.deepEqual(stored.session.reviews, [["src/app.ts", [COMMENT]]]);
    assert.deepEqual(stored.session.analysis.findingsByFile, [["src/app.ts", [FINDING]]]);
  });

  test("leaves the steps that were never run out of the file", () => {
    const stored = JSON.parse(serialize(session())) as { session: Record<string, unknown> };

    for (const step of ["files", "taskContext", "fixes", "draft", "reviews", "analysis"]) {
      assert.equal(step in stored.session, false, `${step} should not be there`);
    }
  });
});

describe("deserialize", () => {
  test("brings back a session that went through JSON, Maps included", () => {
    const restored = deserialize(serialize(fullSession()), "export.json");

    assert.deepEqual(restored, fullSession());
    assert.ok(restored.reviews instanceof Map);
    assert.ok(restored.analysis?.findingsByFile instanceof Map);
  });

  test("leaves the Maps undefined when the steps were never run", () => {
    const restored = deserialize(serialize(session()), "export.json");

    assert.equal(restored.reviews, undefined);
    assert.equal(restored.analysis, undefined);
  });

  test("names the file when it does not hold JSON", () => {
    assert.throws(() => deserialize("{not json", "/tmp/roto.json"), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.equal(error.message, "El archivo /tmp/roto.json no es un JSON válido.");
      return true;
    });
  });

  test("refuses a file written by another version of the server", () => {
    const stored = JSON.parse(serialize(session())) as { version: number };
    stored.version = 2;

    assert.throws(() => deserialize(JSON.stringify(stored), "export.json"), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /usa el formato 2 y este servidor lee el 1/u);
      return true;
    });
  });

  test("refuses a document that is missing what every step needs", () => {
    for (const missing of ["id", "repoPath", "range"]) {
      const stored = JSON.parse(serialize(session())) as { session: Record<string, unknown> };
      delete stored.session[missing];

      assert.throws(
        () => deserialize(JSON.stringify(stored), "export.json"),
        /no contiene una revisión completa/u,
        `should refuse a file with no ${missing}`,
      );
    }
  });

  test("refuses a JSON document that carries no session at all", () => {
    assert.throws(() => deserialize('{"version":1}', "export.json"), /no contiene una revisión completa/u);
  });
});

describe("defaultPath", () => {
  test("is one file per repository and pull request, under the home directory", () => {
    assert.equal(
      defaultPath(session()),
      join(homedir(), ".code-review-steps", "tienda-pr200.json"),
    );
  });

  test("tolerates a repository path with a trailing slash", () => {
    assert.match(defaultPath(session({ repoPath: "/home/me/clones/tienda/" })), /tienda-pr200\.json$/u);
  });

  test("falls back to a name instead of an empty one when the path has no last segment", () => {
    assert.match(defaultPath(session({ repoPath: sep })), /repo-pr200\.json$/u);
  });
});

describe("writeExport and readExport", () => {
  test("write a file that reads back as the same session", async (t) => {
    const file = join(await tempDir(t), "export.json");

    assert.equal(await writeExport(fullSession(), file), file);
    assert.deepEqual(await readExport(file), fullSession());
  });

  test("create the directories the file needs", async (t) => {
    const file = join(await tempDir(t), "nested", "deeper", "export.json");

    await writeExport(session(), file);

    assert.ok((await readFile(file, "utf8")).startsWith("{"));
  });

  test("resolve a relative path against the working directory", async (t) => {
    const dir = await tempDir(t);
    const previous = process.cwd();

    process.chdir(dir);
    t.after(() => process.chdir(previous));

    // Read back from cwd: on macOS the temp directory is reached through a
    // symlink, so process.cwd() is the only path the assertion can trust.
    const written = await writeExport(fullSession(), "export.json");

    assert.equal(written, join(process.cwd(), "export.json"));
    assert.deepEqual(await readExport("export.json"), fullSession());
  });

  test("say where the exports live when the file is not there", async (t) => {
    const file = join(await tempDir(t), "missing.json");

    await assert.rejects(readExport(file), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /No se pudo leer/u);
      assert.match(error.message, /\.code-review-steps/u);
      return true;
    });
  });

  test("keep the specific reason when the file is there but unreadable as a session", async (t) => {
    const file = join(await tempDir(t), "roto.json");

    await writeFile(file, "{not json", "utf8");

    await assert.rejects(readExport(file), /no es un JSON válido/u);
  });
});
