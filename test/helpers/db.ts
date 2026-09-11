import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { closeDb } from "../../src/review/db.js";

/**
 * A database file of its own for one test.
 * Reviews now outlive the process, so without this a test would write into the
 * developer's real store and read what a previous one left behind.
 */
export function useTempDb(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "code-review-steps-"));
  const file = join(dir, "reviews.db");
  const previous = process.env.CODE_REVIEW_MCP_DB;

  process.env.CODE_REVIEW_MCP_DB = file;
  closeDb();

  t.after(() => {
    closeDb();

    if (previous === undefined) {
      delete process.env.CODE_REVIEW_MCP_DB;
    } else {
      process.env.CODE_REVIEW_MCP_DB = previous;
    }

    rmSync(dir, { recursive: true, force: true });
  });

  return file;
}
