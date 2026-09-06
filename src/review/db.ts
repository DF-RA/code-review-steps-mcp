import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { UserFacingError } from "../errors.js";
import type { ReviewSession } from "./session.js";

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
  UNIQUE (repo_path, pr_number, head_ref_oid)
);
CREATE INDEX IF NOT EXISTS reviews_by_pr ON reviews (repo_path, pr_number);
`;

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
  opened.exec(SCHEMA);

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
