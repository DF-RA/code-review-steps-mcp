import { createHash } from "node:crypto";

import { runGit } from "./git/git.js";

export const CHANGE_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "unknown",
] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/* Type aliases, not interfaces: they travel in structuredContent. */
export type ChangedFile = {
  /**
   * Identifier of the file inside its review, derived from the path.
   * Gives the later steps something short and safe to name a file with, instead
   * of a path that carries spaces, accents and slashes.
   */
  pathId: string;
  path: string;
  status: ChangeStatus;
  /** Only on renames and copies. */
  previousPath?: string;
  /** Only available through the GitHub API. */
  additions?: number;
  deletions?: number;
};

/** Same path, same id: it is the path that identifies a file within a review. */
export function pathId(path: string): string {
  return createHash("md5").update(path, "utf8").digest("hex");
}

/** git diff --name-status letters. */
const GIT_STATUS_BY_LETTER: Record<string, ChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/**
 * Parses the NUL-separated output of `git diff --name-status -z`.
 * The -z form avoids git quoting paths with spaces or non-ASCII characters.
 */
function parseNameStatus(stdout: string): ChangedFile[] {
  const tokens = stdout.split("\0").filter((token) => token.length > 0);
  const files: ChangedFile[] = [];

  let index = 0;

  while (index < tokens.length) {
    const rawStatus = tokens[index];

    if (!rawStatus) {
      break;
    }

    const letter = rawStatus.charAt(0);
    const status = GIT_STATUS_BY_LETTER[letter] ?? "unknown";

    // Renames and copies carry a similarity score (R100) and two paths.
    if (letter === "R" || letter === "C") {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];
      index += 3;

      if (path) {
        files.push({ pathId: pathId(path), path, status, previousPath });
      }
      continue;
    }

    const path = tokens[index + 1];
    index += 2;

    if (path) {
      files.push({ pathId: pathId(path), path, status });
    }
  }

  return files;
}

/** Files a pull request touches, from the clone. */
export async function listChangedFiles(cwd: string, range: string): Promise<ChangedFile[]> {
  return parseNameStatus(await runGit(["diff", "--name-status", "-z", range], cwd));
}
