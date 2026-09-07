import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { pathId } from "../../src/changed-files.js";
import type { Finding } from "../../src/analysis/types.js";
import {
  closeDb,
  findAnalysis,
  findDraft,
  findFetchedPathIds,
  findPublishedReviews,
  findFileReview,
  findFileReviews,
  findFileDiff,
  findFixes,
  findReviewByHead,
  findReviewFiles,
  hasReviewFiles,
  hasTaskContext,
  resetReviewSteps,
  saveAnalysis,
  saveDraft,
  saveDraftComment,
  saveDraftConfirmed,
  saveFileDiff,
  saveFix,
  saveFixes,
  savePublishedReview,
  saveFileReview,
  saveReviewFiles,
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

describe("the files of a review", () => {
  const files = [
    { pathId: pathId("src/app.ts"), path: "src/app.ts", status: "modified" as const },
    { pathId: pathId("src/nuevo.ts"), path: "src/nuevo.ts", status: "added" as const },
    {
      pathId: pathId("src/nuevo-nombre.ts"),
      path: "src/nuevo-nombre.ts",
      status: "renamed" as const,
      previousPath: "src/viejo.ts",
    },
  ];

  test("gives them back in the order step 3 listed them", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveReviewFiles("r1", files);

    assert.deepEqual(findReviewFiles("r1"), files);
  });

  test("identifies a file by the md5 of its path", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveReviewFiles("r1", files);

    const back = findReviewFiles("r1") ?? [];

    assert.equal(back[0]?.pathId, pathId("src/app.ts"));
    assert.match(back[0]?.pathId ?? "", /^[0-9a-f]{32}$/u);
  });

  test("tells apart step 3 not run from a pull request that touches nothing", (t) => {
    useTempDb(t);
    saveReview(stored());

    assert.equal(hasReviewFiles("r1"), false);
    assert.equal(findReviewFiles("r1"), undefined);

    saveReviewFiles("r1", []);

    assert.equal(hasReviewFiles("r1"), true);
    assert.deepEqual(findReviewFiles("r1"), []);
  });

  test("listing again replaces the list instead of adding to it", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveReviewFiles("r1", files);
    saveReviewFiles("r1", [files[0]!]);

    assert.deepEqual(findReviewFiles("r1")?.map((file) => file.path), ["src/app.ts"]);
  });

  test("keeps the files of one review out of another", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveReview(stored({ prNumber: 300, headRefOid: "c".repeat(40) }, "r2"));

    saveReviewFiles("r1", files);

    assert.equal(findReviewFiles("r2"), undefined);
  });

  test("refuses files whose review does not exist", (t) => {
    useTempDb(t);

    assert.throws(() => saveReviewFiles("no-existe", files), /FOREIGN KEY constraint failed/u);
  });
});

describe("hasTaskContext", () => {
  test("answers whether step 2 was recorded, without loading it", (t) => {
    useTempDb(t);
    saveReview(stored());

    assert.equal(hasTaskContext("r1"), false);

    saveTaskContext("r1", { found: false, reason: "sin tarea" });

    assert.equal(hasTaskContext("r1"), true);
  });
});

describe("opening a database an older version created", () => {
  /** The reviews table exactly as it shipped before step 3 existed. */
  function oldDatabase(file: string): void {
    const db = new DatabaseSync(file);

    db.exec(`CREATE TABLE reviews (
      id TEXT PRIMARY KEY, pr_number INTEGER NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, url TEXT NOT NULL, author TEXT NOT NULL,
      repo_path TEXT NOT NULL, target_branch TEXT NOT NULL, source_branch TEXT NOT NULL,
      base_sha TEXT NOT NULL, head_sha TEXT NOT NULL, head_ref_oid TEXT NOT NULL,
      diff_range TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (repo_path, pr_number, head_ref_oid)
    )`);
    db.prepare(
      `INSERT INTO reviews VALUES ('viejo',1,'t','','','a','/r','m','f','0','1','1','m...f',1)`,
    ).run();
    db.close();
  }

  test("adds the columns it is missing instead of failing on them", (t) => {
    const file = useTempDb(t);

    closeDb();
    rmSync(file, { force: true });
    oldDatabase(file);

    // Any call opens the connection, and opening is what migrates.
    assert.equal(hasReviewFiles("viejo"), false);

    saveReviewFiles("viejo", []);

    assert.equal(hasReviewFiles("viejo"), true);
  });

  test("keeps the reviews that were already there", (t) => {
    const file = useTempDb(t);

    closeDb();
    rmSync(file, { force: true });
    oldDatabase(file);

    assert.equal(findReviewById("viejo")?.prNumber, 1);
  });
});

describe("ranges stored as branch names", () => {
  /** A row as it was written before the range moved onto the shas. */
  function rowWithNameRange(file: string): void {
    const db = new DatabaseSync(file);

    db.prepare(
      `INSERT INTO reviews (id, pr_number, title, body, url, author, repo_path,
         target_branch, source_branch, base_sha, head_sha, head_ref_oid, diff_range, created_at)
       VALUES ('viejo', 2, 't', '', '', 'a', '/r', 'develop', 'feature/x',
         'f574b20e', '9675d47a', '9675d47a', 'origin/develop...origin/feature/x', 1)`,
    ).run();
    db.close();
  }

  test("are rebuilt from the frozen shas when the database opens", (t) => {
    const file = useTempDb(t);

    // Opening once creates the schema, then the row goes in behind its back.
    saveReview(stored());
    closeDb();
    rowWithNameRange(file);

    assert.equal(findReviewById("viejo")?.range, "f574b20e...9675d47a");
  });

  test("survive being opened again without drifting", (t) => {
    const file = useTempDb(t);

    saveReview(stored());
    closeDb();
    rowWithNameRange(file);

    const once = findReviewById("viejo");
    closeDb();
    const twice = findReviewById("viejo");

    assert.equal(once?.range, "f574b20e...9675d47a");
    assert.deepEqual(twice, once);
  });

  test("keep the rest of the row untouched", (t) => {
    const file = useTempDb(t);

    saveReview(stored());
    closeDb();
    rowWithNameRange(file);

    const back = findReviewById("viejo");

    assert.equal(back?.prNumber, 2);
    assert.equal(back?.targetBranch, "develop");
    assert.equal(back?.sourceBranch, "feature/x");
    assert.equal(back?.headSha, "9675d47a");
  });
});

describe("restarting a review", () => {
  function reviewWithEveryStep(): void {
    saveReview(stored());
    saveTaskContext("r1", { found: true, code: "PROJ-1" });
    saveReviewFiles("r1", [
      { pathId: pathId("src/app.ts"), path: "src/app.ts", status: "modified" },
    ]);
  }

  test("throws away what the later steps produced", (t) => {
    useTempDb(t);
    reviewWithEveryStep();

    resetReviewSteps("r1");

    assert.equal(findTaskContext("r1"), undefined);
    assert.equal(findReviewFiles("r1"), undefined);
  });

  test("puts step 3 back to never having run, not to having found nothing", (t) => {
    useTempDb(t);
    reviewWithEveryStep();

    resetReviewSteps("r1");

    assert.equal(hasReviewFiles("r1"), false);
  });

  test("keeps the review itself, which is what its id names", (t) => {
    useTempDb(t);
    reviewWithEveryStep();

    resetReviewSteps("r1");

    const back = findReviewById("r1");

    assert.equal(back?.id, "r1");
    assert.equal(back?.headSha, "b".repeat(40));
    assert.equal(back?.range, `${"a".repeat(40)}...${"b".repeat(40)}`);
  });

  test("leaves other reviews alone", (t) => {
    useTempDb(t);
    reviewWithEveryStep();
    saveReview(stored({ prNumber: 300, headRefOid: "c".repeat(40) }, "r2"));
    saveTaskContext("r2", { found: true, code: "PROJ-2" });

    resetReviewSteps("r1");

    assert.equal(findTaskContext("r2")?.code, "PROJ-2");
  });
});

describe("the analysis of a review", () => {
  function finding(path: string, line: number, severity: "high" | "medium" | "low") {
    return {
      tool: "ESLint",
      path,
      line,
      endLine: line,
      rule: "no-unused-vars",
      severity,
      message: `algo en ${path}:${line}`,
    };
  }

  const analysis = {
    tools: ["ESLint", "Semgrep"],
    skipped: [{ tool: "Ruff", reason: "no está instalado" }],
    unanalyzed: ["README.md"],
    findingsByFile: new Map([
      ["src/app.ts", [finding("src/app.ts", 3, "high" as const), finding("src/app.ts", 9, "low" as const)]],
      ["src/otro.ts", [finding("src/otro.ts", 1, "medium" as const)]],
    ]),
  };

  test("gives back what the analyzers produced", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveAnalysis("r1", analysis);

    assert.deepEqual(findAnalysis("r1"), analysis);
  });

  test("keeps the conditions the findings were produced under", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveAnalysis("r1", analysis);

    const back = findAnalysis("r1");

    // Without these, no findings and nobody looked read the same.
    assert.deepEqual(back?.tools, ["ESLint", "Semgrep"]);
    assert.deepEqual(back?.skipped, [{ tool: "Ruff", reason: "no está instalado" }]);
    assert.deepEqual(back?.unanalyzed, ["README.md"]);
  });

  test("keeps the order of the findings inside each file", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveAnalysis("r1", analysis);

    assert.deepEqual(
      findAnalysis("r1")?.findingsByFile.get("src/app.ts")?.map((found: Finding) => found.line),
      [3, 9],
    );
  });

  test("tells apart not run from run and clean", (t) => {
    useTempDb(t);
    saveReview(stored());

    assert.equal(findAnalysis("r1"), undefined);

    saveAnalysis("r1", { tools: ["ESLint"], skipped: [], unanalyzed: [], findingsByFile: new Map() });

    const back = findAnalysis("r1");

    assert.deepEqual(back?.tools, ["ESLint"]);
    assert.equal(back?.findingsByFile.size, 0);
  });

  test("analysing again replaces the previous outcome", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveAnalysis("r1", analysis);
    saveAnalysis("r1", { tools: ["Ruff"], skipped: [], unanalyzed: [], findingsByFile: new Map() });

    assert.deepEqual(findAnalysis("r1")?.tools, ["Ruff"]);
    assert.equal(findAnalysis("r1")?.findingsByFile.size, 0);
  });

  test("refuses an analysis whose review does not exist", (t) => {
    useTempDb(t);

    assert.throws(() => saveAnalysis("no-existe", analysis), /FOREIGN KEY constraint failed/u);
  });

  test("goes away when the review is restarted", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveAnalysis("r1", analysis);

    resetReviewSteps("r1");

    assert.equal(findAnalysis("r1"), undefined);
  });
});

describe("the diff of a file", () => {
  const APP = pathId("src/app.ts");
  const OTRO = pathId("src/otro.ts");

  function reviewWithFiles(): void {
    saveReview(stored());
    saveReviewFiles("r1", [
      { pathId: APP, path: "src/app.ts", status: "modified" },
      { pathId: OTRO, path: "src/otro.ts", status: "added" },
    ]);
  }

  test("gives back the whole diff, not the part that was asked for", (t) => {
    useTempDb(t);
    reviewWithFiles();

    saveFileDiff("r1", APP, "diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n", 1);

    assert.equal(findFileDiff("r1", APP)?.diff.includes("@@ -1 +1 @@"), true);
    assert.equal(findFileDiff("r1", APP)?.totalHunks, 1);
  });

  test("does not answer for a file nobody fetched", (t) => {
    useTempDb(t);
    reviewWithFiles();

    assert.equal(findFileDiff("r1", OTRO), undefined);
  });

  test("refuses a diff of a file the review does not list", (t) => {
    useTempDb(t);
    reviewWithFiles();

    assert.throws(
      () => saveFileDiff("r1", pathId("src/fantasma.ts"), "diff", 1),
      /FOREIGN KEY constraint failed/u,
    );
  });

  test("says which files have been walked, in the listing order", (t) => {
    useTempDb(t);
    reviewWithFiles();

    // Fetched out of order on purpose: the answer follows the review, not this.
    saveFileDiff("r1", OTRO, "d2", 1);
    saveFileDiff("r1", APP, "d1", 1);

    assert.deepEqual(findFetchedPathIds("r1"), [APP, OTRO]);
  });

  test("goes with the files when the list is replaced", (t) => {
    useTempDb(t);
    reviewWithFiles();
    saveFileDiff("r1", APP, "d1", 1);

    // Relisting drops the rows, and the diffs hang off them.
    saveReviewFiles("r1", [{ pathId: OTRO, path: "src/otro.ts", status: "added" }]);

    assert.equal(findFileDiff("r1", APP), undefined);
  });

  test("goes away when the review is restarted", (t) => {
    useTempDb(t);
    reviewWithFiles();
    saveFileDiff("r1", APP, "d1", 1);

    resetReviewSteps("r1");

    assert.equal(findFileDiff("r1", APP), undefined);
  });
});

describe("the review of a file", () => {
  const APP = pathId("src/app.ts");
  const OTRO = pathId("src/otro.ts");

  const comment = {
    scope: "line" as const,
    path: "src/app.ts",
    line: 12,
    severity: "issue" as const,
    title: "El error se traga",
    body: "El catch vacío oculta el fallo.",
    raisedBy: "programador",
  };

  function reviewWithFiles(): void {
    saveReview(stored());
    saveReviewFiles("r1", [
      { pathId: APP, path: "src/app.ts", status: "modified" },
      { pathId: OTRO, path: "src/otro.ts", status: "added" },
    ]);
  }

  test("gives back the comments in the order they were concluded", (t) => {
    useTempDb(t);
    reviewWithFiles();

    const second = { ...comment, line: 40, title: "Nombre que engaña" };
    saveFileReview("r1", APP, [comment, second]);

    assert.deepEqual(findFileReview("r1", APP), [comment, second]);
  });

  test("tells apart reviewed with nothing to say from not reviewed", (t) => {
    useTempDb(t);
    reviewWithFiles();

    assert.equal(findFileReview("r1", APP), undefined);

    saveFileReview("r1", APP, []);

    // A row in review_file and none in review_comment: looked at, nothing said.
    assert.deepEqual(findFileReview("r1", APP), []);
  });

  test("keeps a pr-scoped comment without a path, and a line one with it", (t) => {
    useTempDb(t);
    reviewWithFiles();

    saveFileReview("r1", APP, [
      comment,
      { scope: "pr", severity: "blocker", title: "Pipeline en rojo", body: "Falla el build." },
    ]);

    const back = findFileReview("r1", APP) ?? [];

    assert.equal(back[0]?.path, "src/app.ts");
    assert.equal(back[1]?.path, undefined);
  });

  test("recording it again replaces the comments instead of adding to them", (t) => {
    useTempDb(t);
    reviewWithFiles();

    saveFileReview("r1", APP, [comment, { ...comment, line: 40, title: "Otro" }]);
    saveFileReview("r1", APP, [{ ...comment, title: "El de la segunda vuelta" }]);

    const back = findFileReview("r1", APP) ?? [];

    assert.equal(back.length, 1);
    assert.equal(back[0]?.title, "El de la segunda vuelta");
  });

  test("refuses the review of a file the pull request does not touch", (t) => {
    useTempDb(t);
    reviewWithFiles();

    assert.throws(
      () => saveFileReview("r1", pathId("src/fantasma.ts"), [comment]),
      /FOREIGN KEY constraint failed/u,
    );
  });

  test("lists every reviewed file in the listing order, empty ones included", (t) => {
    useTempDb(t);
    reviewWithFiles();

    // Recorded out of order on purpose: the answer follows the review.
    saveFileReview("r1", OTRO, []);
    saveFileReview("r1", APP, [comment]);

    const all = findFileReviews("r1");

    assert.deepEqual([...(all?.keys() ?? [])], ["src/app.ts", "src/otro.ts"]);
    assert.equal(all?.get("src/otro.ts")?.length, 0);
    assert.equal(all?.get("src/app.ts")?.length, 1);
  });

  test("says nothing has been reviewed instead of an empty map", (t) => {
    useTempDb(t);
    reviewWithFiles();

    assert.equal(findFileReviews("r1"), undefined);
  });

  test("goes with the files when the list is replaced", (t) => {
    useTempDb(t);
    reviewWithFiles();
    saveFileReview("r1", APP, [comment]);

    saveReviewFiles("r1", [{ pathId: OTRO, path: "src/otro.ts", status: "added" }]);

    assert.equal(findFileReview("r1", APP), undefined);
  });

  test("goes away when the review is restarted", (t) => {
    useTempDb(t);
    reviewWithFiles();
    saveFileReview("r1", APP, [comment]);

    resetReviewSteps("r1");

    assert.equal(findFileReviews("r1"), undefined);
  });
});

describe("the draft", () => {
  const comment = {
    id: "abc123def456",
    scope: "line" as const,
    severity: "issue" as const,
    path: "src/app.ts",
    line: 12,
    title: "El error se traga",
    body: "El catch vacío oculta el fallo.",
    status: "pending" as const,
    edited: false,
  };

  const draft = { comments: [comment], confirmed: false, createdAt: 1_700_000_000_000 };

  test("gives back what step 7 built", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveDraft("r1", draft);

    assert.deepEqual(findDraft("r1"), draft);
  });

  test("does not answer before step 7 has run", (t) => {
    useTempDb(t);
    saveReview(stored());

    assert.equal(findDraft("r1"), undefined);
  });

  test("keeps a pr-scoped comment without a path", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveDraft("r1", {
      ...draft,
      comments: [
        {
          id: "pr01",
          scope: "pr" as const,
          severity: "blocker" as const,
          title: "Pipeline en rojo",
          body: "Falla el build.",
          status: "pending" as const,
          edited: false,
        },
      ],
    });

    assert.equal(findDraft("r1")?.comments[0]?.path, undefined);
  });

  test("keeps what somebody marked in the page", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveDraft("r1", draft);

    saveDraftComment("r1", { ...comment, status: "valid" });

    assert.equal(findDraft("r1")?.comments[0]?.status, "valid");
  });

  test("keeps a body edited in the page, and that it was edited", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveDraft("r1", draft);

    saveDraftComment("r1", { ...comment, body: "Reescrito a mano.", edited: true });

    const back = findDraft("r1")?.comments[0];

    assert.equal(back?.body, "Reescrito a mano.");
    assert.equal(back?.edited, true);
  });

  test("keeps the confirmation", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveDraft("r1", draft);

    assert.equal(findDraft("r1")?.confirmed, false);

    saveDraftConfirmed("r1", true);

    assert.equal(findDraft("r1")?.confirmed, true);
  });

  test("redrafting replaces the comments instead of adding to them", (t) => {
    useTempDb(t);
    saveReview(stored());

    saveDraft("r1", { ...draft, comments: [comment, { ...comment, id: "otro" }] });
    saveDraft("r1", draft);

    assert.equal(findDraft("r1")?.comments.length, 1);
  });

  test("refuses a draft whose review does not exist", (t) => {
    useTempDb(t);

    assert.throws(() => saveDraft("no-existe", draft), /FOREIGN KEY constraint failed/u);
  });

  test("goes away when the review is restarted", (t) => {
    useTempDb(t);
    saveReview(stored());
    saveDraft("r1", draft);

    resetReviewSteps("r1");

    assert.equal(findDraft("r1"), undefined);
  });
});

describe("what was already published", () => {
  const first = { publishedAt: 1_700_000_000_000, event: "COMMENT", url: "https://gh/r/1", comments: 3 };
  const second = { publishedAt: 1_700_000_900_000, event: "REQUEST_CHANGES", comments: 2 };

  test("says nothing was published before anything was", (t) => {
    useTempDb(t);
    saveReview(stored());

    assert.deepEqual(findPublishedReviews("r1"), []);
  });

  test("keeps every publication, oldest first", (t) => {
    useTempDb(t);
    saveReview(stored());

    savePublishedReview("r1", second);
    savePublishedReview("r1", first);

    assert.deepEqual(findPublishedReviews("r1"), [first, second]);
  });

  test("does not lose one publication behind another of the same review", (t) => {
    useTempDb(t);
    saveReview(stored());

    savePublishedReview("r1", first);
    savePublishedReview("r1", { ...first, event: "APPROVE" });

    assert.equal(findPublishedReviews("r1").length, 2);
  });

  test("survives restarting the review, because GitHub does not restart", (t) => {
    useTempDb(t);
    saveReview(stored());
    savePublishedReview("r1", first);

    resetReviewSteps("r1");

    assert.deepEqual(findPublishedReviews("r1"), [first]);
  });

  test("refuses a publication of a review that does not exist", (t) => {
    useTempDb(t);

    assert.throws(() => savePublishedReview("no-existe", first), /FOREIGN KEY constraint failed/u);
  });
});

describe("the work list", () => {
  const draftComment = {
    id: "abc123def456",
    scope: "line" as const,
    severity: "issue" as const,
    path: "src/app.ts",
    line: 12,
    title: "El error se traga",
    body: "El catch vacío oculta el fallo.",
    status: "valid" as const,
    edited: false,
  };

  const fix = {
    id: "abc123def456",
    path: "src/app.ts",
    line: 12,
    severity: "issue",
    title: "El error se traga",
    body: "El catch vacío oculta el fallo.",
    status: "pending" as const,
  };

  function reviewWithDraft(): void {
    saveReview(stored());
    saveDraft("r1", { comments: [draftComment], confirmed: true, createdAt: 1 });
  }

  test("gives back the points in the order the list was built", (t) => {
    useTempDb(t);
    reviewWithDraft();

    saveFixes("r1", [fix]);

    assert.deepEqual(findFixes("r1"), [fix]);
  });

  test("does not answer before step 9b has run", (t) => {
    useTempDb(t);
    reviewWithDraft();

    assert.equal(findFixes("r1"), undefined);
  });

  test("keeps a point closed, with the note of what was done", (t) => {
    useTempDb(t);
    reviewWithDraft();
    saveFixes("r1", [fix]);

    saveFix("r1", { ...fix, status: "done", note: "Se propaga el error al llamante." });

    const back = findFixes("r1")?.[0];

    assert.equal(back?.status, "done");
    assert.equal(back?.note, "Se propaga el error al llamante.");
  });

  test("keeps a point that was deliberately skipped", (t) => {
    useTempDb(t);
    reviewWithDraft();
    saveFixes("r1", [fix]);

    saveFix("r1", { ...fix, status: "skipped", note: "Va en otro PR." });

    assert.equal(findFixes("r1")?.[0]?.status, "skipped");
  });

  test("refuses a point that comes from no approved comment", (t) => {
    useTempDb(t);
    reviewWithDraft();

    assert.throws(
      () => saveFixes("r1", [{ ...fix, id: "no-existe" }]),
      /FOREIGN KEY constraint failed/u,
    );
  });

  test("goes away when the draft is rebuilt", (t) => {
    useTempDb(t);
    reviewWithDraft();
    saveFixes("r1", [fix]);

    // Redrafting replaces draft_comment, and the list hangs off it.
    saveDraft("r1", { comments: [], confirmed: false, createdAt: 2 });

    assert.equal(findFixes("r1"), undefined);
  });

  test("goes away when the review is restarted", (t) => {
    useTempDb(t);
    reviewWithDraft();
    saveFixes("r1", [fix]);

    resetReviewSteps("r1");

    assert.equal(findFixes("r1"), undefined);
  });
});
