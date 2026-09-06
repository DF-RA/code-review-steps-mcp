import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Finding } from "../analysis/types.js";
import type { ChangedFile, ChangeStatus } from "../changed-files.js";
import { UserFacingError } from "../errors.js";
import type { TaskContext } from "./task-context.js";
import type { ReviewSession } from "./session.js";
import type { SkippedAnalyzer } from "../static-analysis.js";

/**
 * Everything step 1 produces, kept on disk instead of in memory.
 *
 * A review survives the process that opened it, so recognising a pull request
 * we already looked at stops depending on a map that a restart empties. The
 * later steps still carry their state in memory; each one moves here as it is
 * migrated.
 */

/** Overridable so tests get their own file instead of the developer's. */
const DB_PATH_ENV = "CODE_REVIEW_MCP_DB";

const DEFAULT_PATH = join(homedir(), ".code-review-steps", "reviews.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT    PRIMARY KEY,
  pr_number     INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  url           TEXT    NOT NULL,
  author        TEXT    NOT NULL,
  repo_path     TEXT    NOT NULL,
  target_branch TEXT    NOT NULL,
  source_branch TEXT    NOT NULL,
  base_sha      TEXT    NOT NULL,
  head_sha      TEXT    NOT NULL,
  head_ref_oid  TEXT    NOT NULL,
  diff_range    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  -- When step 3 ran. Null and "ran, and the diff was empty" are different
  -- answers, and no count of rows can tell them apart.
  files_listed_at INTEGER,
  UNIQUE (repo_path, pr_number, head_ref_oid)
);
CREATE INDEX IF NOT EXISTS reviews_by_pr ON reviews (repo_path, pr_number);

CREATE TABLE IF NOT EXISTS context (
  review_id TEXT    PRIMARY KEY REFERENCES reviews (id) ON DELETE CASCADE,
  found     INTEGER NOT NULL,
  reason    TEXT,
  code      TEXT,
  title     TEXT,
  summary   TEXT,
  url       TEXT
);

CREATE TABLE IF NOT EXISTS changed_file (
  review_id     TEXT    NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  path_id       TEXT    NOT NULL,
  path          TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  previous_path TEXT,
  position      INTEGER NOT NULL,
  PRIMARY KEY (review_id, path_id)
);

CREATE TABLE IF NOT EXISTS analyze_pr (
  review_id   TEXT    PRIMARY KEY REFERENCES reviews (id) ON DELETE CASCADE,
  -- Which analyzers ran, which did not and why, and the files none of them
  -- covers: the conditions the findings were produced under, without which a
  -- short list of problems cannot be told from a shallow look.
  tools       TEXT    NOT NULL,
  skipped     TEXT    NOT NULL,
  unanalyzed  TEXT    NOT NULL,
  -- Findings flat and in order; step 5 wants them grouped by file, and the
  -- grouping is rebuilt on the way out.
  findings    TEXT    NOT NULL,
  analyzed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_diff (
  review_id   TEXT    NOT NULL,
  path_id     TEXT    NOT NULL,
  -- The whole diff of the file, not the part that was asked for: the parts are
  -- cuts of this text, so keeping it whole serves any offset later.
  diff        TEXT    NOT NULL,
  total_hunks INTEGER NOT NULL,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (review_id, path_id),
  FOREIGN KEY (review_id, path_id) REFERENCES changed_file (review_id, path_id) ON DELETE CASCADE
);
`;

/**
 * Adds a column that a database created by an earlier version does not have.
 *
 * CREATE TABLE IF NOT EXISTS leaves an existing table exactly as it was, so
 * every column added after a table has shipped has to come through here or it
 * only exists for whoever starts from an empty file. SQLite can only add a
 * column this way if it is nullable or carries a default.
 *
 * Table and column names are literals from this file, never input.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];

  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Renames tables that shipped under another name, before the schema runs.
 *
 * Order matters: CREATE TABLE IF NOT EXISTS would make an empty table under the
 * new name first, and then there would be nowhere to rename the old one to.
 */
function renameLegacyTables(db: DatabaseSync): void {
  const names = new Set(
    (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as unknown as {
        name: string;
      }[]
    ).map((row) => row.name),
  );

  // review_file collided with the review_file prompt, which is a different
  // thing: this one is the list of files a pull request changes.
  if (names.has("review_file") && !names.has("changed_file")) {
    db.exec("ALTER TABLE review_file RENAME TO changed_file");
  }
}

/** Columns added after their table shipped, in the order they appeared. */
function migrate(db: DatabaseSync): void {
  ensureColumn(db, "reviews", "files_listed_at", "INTEGER");

  // Ranges used to be stored as branch names, which point somewhere else after
  // a fetch. The frozen shas of those same rows say what the review is really
  // about, so the range is rebuilt from them. The condition makes it a no-op
  // once a row is already on shas.
  db.exec(
    `UPDATE reviews SET diff_range = base_sha || '...' || head_sha
      WHERE diff_range <> base_sha || '...' || head_sha`,
  );
}

let db: DatabaseSync | undefined;

function connect(): DatabaseSync {
  if (db) {
    return db;
  }

  const path = process.env[DB_PATH_ENV]?.trim() || DEFAULT_PATH;

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const opened = new DatabaseSync(path);

  // Readers do not block the writer: the MCP client and the Inspector can hold
  // the same file open. The timeout covers the writes that do collide.
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA busy_timeout = 5000");

  // SQLite ignores foreign keys unless they are switched on per connection, and
  // a context without its review is exactly what the key is there to prevent.
  opened.exec("PRAGMA foreign_keys = ON");
  renameLegacyTables(opened);
  opened.exec(SCHEMA);
  migrate(opened);

  db = opened;

  return db;
}

/** Lets a test point at a fresh file, and the next call reopen from the env. */
export function closeDb(): void {
  db?.close();
  db = undefined;
}

/** Only the columns: what the later steps keep in memory does not travel here. */
export type StoredReview = Omit<
  ReviewSession,
  "files" | "taskContext" | "fixes" | "draft" | "reviews" | "analysis"
>;

interface Row {
  id: string;
  pr_number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  repo_path: string;
  target_branch: string;
  source_branch: string;
  base_sha: string;
  head_sha: string;
  head_ref_oid: string;
  diff_range: string;
  created_at: number;
}

function toReview(row: Row): StoredReview {
  return {
    id: row.id,
    prNumber: row.pr_number,
    title: row.title,
    body: row.body,
    url: row.url,
    author: row.author,
    repoPath: row.repo_path,
    targetBranch: row.target_branch,
    sourceBranch: row.source_branch,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    headRefOid: row.head_ref_oid,
    range: row.diff_range,
    createdAt: row.created_at,
  };
}

/**
 * Writes the review, replacing the row if that same id is already there.
 *
 * The unique triple is the real identity of a review — one clone, one pull
 * request, one head — so a second id for the same code is a caller that forgot
 * to look it up first, and is worth saying out loud.
 */
export function saveReview(review: StoredReview): void {
  try {
    insert(review);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      const existing = findReviewByHead(review.repoPath, review.prNumber, review.headRefOid);

      throw new UserFacingError(
        `Ya hay una revisión de ese head (${review.headRefOid.slice(0, 8)}) del PR #${review.prNumber}` +
          (existing ? ` con id ${existing.id}` : "") +
          ". Usa esa en vez de abrir otra.",
      );
    }

    throw error;
  }
}

function insert(review: StoredReview): void {
  connect()
    .prepare(
      `INSERT INTO reviews (
         id, pr_number, title, body, url, author, repo_path, target_branch,
         source_branch, base_sha, head_sha, head_ref_oid, diff_range, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         pr_number = excluded.pr_number,
         title = excluded.title,
         body = excluded.body,
         url = excluded.url,
         author = excluded.author,
         repo_path = excluded.repo_path,
         target_branch = excluded.target_branch,
         source_branch = excluded.source_branch,
         base_sha = excluded.base_sha,
         head_sha = excluded.head_sha,
         head_ref_oid = excluded.head_ref_oid,
         diff_range = excluded.diff_range`,
    )
    .run(
      review.id,
      review.prNumber,
      review.title,
      review.body,
      review.url,
      review.author,
      review.repoPath,
      review.targetBranch,
      review.sourceBranch,
      review.baseSha,
      review.headSha,
      review.headRefOid,
      review.range,
      review.createdAt,
    );
}

export function findReviewById(id: string): StoredReview | undefined {
  const row = connect().prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as unknown as Row | undefined;

  return row ? toReview(row) : undefined;
}

/** The review of this exact code: same clone, same pull request, same head. */
export function findReviewByHead(
  repoPath: string,
  prNumber: number,
  headRefOid: string,
): StoredReview | undefined {
  const row = connect()
    .prepare(
      `SELECT * FROM reviews
        WHERE repo_path = ? AND pr_number = ? AND head_ref_oid = ?`,
    )
    .get(repoPath, prNumber, headRefOid) as unknown as Row | undefined;

  return row ? toReview(row) : undefined;
}

/** Earlier reviews of this pull request, newest first: the head has moved. */
export function findReviewsOfPr(repoPath: string, prNumber: number): StoredReview[] {
  const rows = connect()
    .prepare(
      `SELECT * FROM reviews
        WHERE repo_path = ? AND pr_number = ?
        ORDER BY created_at DESC`,
    )
    .all(repoPath, prNumber) as unknown as Row[];

  return rows.map(toReview);
}

interface ContextRow {
  found: number;
  reason: string | null;
  code: string | null;
  title: string | null;
  summary: string | null;
  url: string | null;
}

/** Absent columns come back as null; the domain type says undefined. */
function text(value: string | null): string | undefined {
  return value ?? undefined;
}

/**
 * Stores what step 2 found out about the task.
 *
 * One row per review, replaced whole: recording the context again is correcting
 * it, not adding a second one. The review has to exist first — the foreign key
 * is what says a context belongs to a review and nothing else.
 */
export function saveTaskContext(reviewId: string, context: TaskContext): void {
  connect()
    .prepare(
      `INSERT INTO context (review_id, found, reason, code, title, summary, url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (review_id) DO UPDATE SET
         found = excluded.found,
         reason = excluded.reason,
         code = excluded.code,
         title = excluded.title,
         summary = excluded.summary,
         url = excluded.url`,
    )
    .run(
      reviewId,
      context.found ? 1 : 0,
      context.reason ?? null,
      context.code ?? null,
      context.title ?? null,
      context.summary ?? null,
      context.url ?? null,
    );
}

/**
 * The context of a review, or undefined when step 2 has not run.
 *
 * No row and a row saying found: false are different answers: the first means
 * nobody looked, the second that somebody looked and there was nothing.
 */
export function findTaskContext(reviewId: string): TaskContext | undefined {
  const row = connect()
    .prepare(`SELECT * FROM context WHERE review_id = ?`)
    .get(reviewId) as unknown as ContextRow | undefined;

  if (!row) {
    return undefined;
  }

  return {
    found: row.found === 1,
    reason: text(row.reason),
    code: text(row.code),
    title: text(row.title),
    summary: text(row.summary),
    url: text(row.url),
  };
}

/** Whether step 2 was recorded, without loading what it found. */
export function hasTaskContext(reviewId: string): boolean {
  return (
    connect().prepare(`SELECT 1 FROM context WHERE review_id = ?`).get(reviewId) !== undefined
  );
}

interface FileRow {
  path_id: string;
  path: string;
  status: string;
  previous_path: string | null;
}

/**
 * Stores the files of a review, replacing whatever was there.
 *
 * Listing them again is redoing step 3, not adding to it, so the old rows go:
 * a file that is no longer in the diff must not stay behind as reviewable. The
 * position column keeps the order git gave them, which is the order the review
 * follows.
 */
export function saveReviewFiles(reviewId: string, files: ChangedFile[]): void {
  const db = connect();

  db.exec("BEGIN");

  try {
    db.prepare(`DELETE FROM changed_file WHERE review_id = ?`).run(reviewId);
    db.prepare(`UPDATE reviews SET files_listed_at = ? WHERE id = ?`).run(Date.now(), reviewId);

    const insert = db.prepare(
      `INSERT INTO changed_file (review_id, path_id, path, status, previous_path, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    files.forEach((file, position) => {
      insert.run(reviewId, file.pathId, file.path, file.status, file.previousPath ?? null, position);
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");

    throw error;
  }
}

/** Whether step 3 ran, whatever it found. */
export function hasReviewFiles(reviewId: string): boolean {
  const row = connect()
    .prepare(`SELECT files_listed_at FROM reviews WHERE id = ?`)
    .get(reviewId) as unknown as { files_listed_at: number | null } | undefined;

  return row?.files_listed_at != null;
}

/**
 * The files of a review in the order step 3 listed them, or undefined when it
 * has not run. An empty list is an answer: a pull request that touches nothing.
 */
export function findReviewFiles(reviewId: string): ChangedFile[] | undefined {
  if (!hasReviewFiles(reviewId)) {
    return undefined;
  }

  const rows = connect()
    .prepare(
      `SELECT path_id, path, status, previous_path
         FROM changed_file WHERE review_id = ? ORDER BY position`,
    )
    .all(reviewId) as unknown as FileRow[];

  // The key is left out when there is no rename, so what comes back out equals
  // what listChangedFiles produced going in.
  return rows.map((row) => ({
    pathId: row.path_id,
    path: row.path,
    status: row.status as ChangeStatus,
    ...(row.previous_path ? { previousPath: row.previous_path } : {}),
  }));
}

/**
 * Throws away everything the steps after the first left for a review, keeping
 * the review itself.
 *
 * The row in reviews is the identity of the review — its id, its pull request,
 * its frozen commits — and that is precisely what must not change: redoing the
 * work is not opening another review of the same code. Everything the later
 * steps derived from it goes, including the mark on reviews that says step 3
 * ran, which lives there rather than in a table of its own.
 */
export function resetReviewSteps(reviewId: string): void {
  const db = connect();

  db.exec("BEGIN");

  try {
    db.prepare(`DELETE FROM analyze_pr WHERE review_id = ?`).run(reviewId);
    db.prepare(`DELETE FROM changed_file WHERE review_id = ?`).run(reviewId);
    db.prepare(`DELETE FROM context WHERE review_id = ?`).run(reviewId);
    db.prepare(`UPDATE reviews SET files_listed_at = NULL WHERE id = ?`).run(reviewId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");

    throw error;
  }
}

/** What step 4 leaves behind, as the session carries it. */
export type StoredAnalysis = NonNullable<ReviewSession["analysis"]>;

interface AnalysisRow {
  tools: string;
  skipped: string;
  unanalyzed: string;
  findings: string;
}

/**
 * Stores the outcome of step 4, replacing any previous one.
 *
 * The findings go in flat and in the order the analysis sorted them, which is
 * by severity and then by path: grouping them by file is a shape step 5 wants,
 * not information, so it is rebuilt on reading instead of stored twice.
 */
export function saveAnalysis(reviewId: string, analysis: StoredAnalysis): void {
  connect()
    .prepare(
      `INSERT INTO analyze_pr (review_id, tools, skipped, unanalyzed, findings, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (review_id) DO UPDATE SET
         tools = excluded.tools,
         skipped = excluded.skipped,
         unanalyzed = excluded.unanalyzed,
         findings = excluded.findings,
         analyzed_at = excluded.analyzed_at`,
    )
    .run(
      reviewId,
      JSON.stringify(analysis.tools),
      JSON.stringify(analysis.skipped),
      JSON.stringify(analysis.unanalyzed),
      JSON.stringify([...analysis.findingsByFile.values()].flat()),
      Date.now(),
    );
}

/** The analysis of a review, or undefined when step 4 has not run. */
export function findAnalysis(reviewId: string): StoredAnalysis | undefined {
  const row = connect()
    .prepare(`SELECT tools, skipped, unanalyzed, findings FROM analyze_pr WHERE review_id = ?`)
    .get(reviewId) as unknown as AnalysisRow | undefined;

  if (!row) {
    return undefined;
  }

  const findingsByFile = new Map<string, Finding[]>();

  for (const finding of JSON.parse(row.findings) as Finding[]) {
    const forFile = findingsByFile.get(finding.path) ?? [];

    forFile.push(finding);
    findingsByFile.set(finding.path, forFile);
  }

  return {
    tools: JSON.parse(row.tools) as string[],
    skipped: JSON.parse(row.skipped) as SkippedAnalyzer[],
    unanalyzed: JSON.parse(row.unanalyzed) as string[],
    findingsByFile,
  };
}

export interface StoredFileDiff {
  diff: string;
  totalHunks: number;
}

/**
 * Stores the diff of one file of a review.
 *
 * Hangs off review_file rather than off the review: a diff is of a file that
 * this review listed, and the foreign key says so. Relisting the files takes
 * the diffs with it, because a diff of a file no longer in the review is not
 * something to keep.
 */
export function saveFileDiff(reviewId: string, pathId: string, diff: string, totalHunks: number): void {
  connect()
    .prepare(
      `INSERT INTO file_diff (review_id, path_id, diff, total_hunks, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (review_id, path_id) DO UPDATE SET
         diff = excluded.diff,
         total_hunks = excluded.total_hunks,
         fetched_at = excluded.fetched_at`,
    )
    .run(reviewId, pathId, diff, totalHunks, Date.now());
}

/** The stored diff of a file, or undefined when nobody has asked for it yet. */
export function findFileDiff(reviewId: string, pathId: string): StoredFileDiff | undefined {
  const row = connect()
    .prepare(`SELECT diff, total_hunks FROM file_diff WHERE review_id = ? AND path_id = ?`)
    .get(reviewId, pathId) as unknown as { diff: string; total_hunks: number } | undefined;

  return row ? { diff: row.diff, totalHunks: row.total_hunks } : undefined;
}

/** Which files of a review have had their diff fetched, in the listing order. */
export function findFetchedPathIds(reviewId: string): string[] {
  const rows = connect()
    .prepare(
      `SELECT d.path_id AS path_id
         FROM file_diff d
         JOIN changed_file f ON f.review_id = d.review_id AND f.path_id = d.path_id
        WHERE d.review_id = ?
        ORDER BY f.position`,
    )
    .all(reviewId) as unknown as { path_id: string }[];

  return rows.map((row) => row.path_id);
}
