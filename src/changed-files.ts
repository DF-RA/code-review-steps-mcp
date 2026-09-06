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
  path: string;
  status: ChangeStatus;
  /** Only on renames and copies. */
  previousPath?: string;
  /** Only available through the GitHub API. */
  additions?: number;
  deletions?: number;
};

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
        files.push({ path, status, previousPath });
      }
      continue;
    }

    const path = tokens[index + 1];
    index += 2;

    if (path) {
      files.push({ path, status });
    }
  }

  return files;
}

/** Files a pull request touches, from the clone. */
export async function listChangedFiles(cwd: string, range: string): Promise<ChangedFile[]> {
  return parseNameStatus(await runGit(["diff", "--name-status", "-z", range], cwd));
}
