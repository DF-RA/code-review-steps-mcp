import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ARCHIVE_TIMEOUT_MS = 60_000;

export interface BaseCopy {
  /** Directory holding the base version of the requested files. */
  dir: string;
  /** Files that existed at the base revision. Added files are not here. */
  files: string[];
  cleanup(): Promise<void>;
}

/**
 * Extracts the base version of some files into a temporary directory.
 *
 * Uses `git archive` piped into `tar` rather than a checkout or a worktree: it
 * touches nothing in the clone, leaves no state behind, and only materializes
 * the files the pull request touches.
 */
export async function extractBaseVersion(
  cwd: string,
  baseRef: string,
  files: string[],
): Promise<BaseCopy> {
  const dir = await mkdtemp(join(tmpdir(), "code-review-base-"));

  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };

  // Files added by the PR do not exist at the base revision, and git archive
  // fails on unknown paths, so ask git which ones are actually there.
  const { stdout } = await execFileAsync(
    "git",
    ["ls-tree", "-r", "--name-only", baseRef, "--", ...files],
    { cwd, timeout: ARCHIVE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );

  const existing = stdout.split("\n").filter(Boolean);

  if (existing.length === 0) {
    return { dir, files: [], cleanup };
  }

  await new Promise<void>((resolve, reject) => {
    const archive = execFile(
      "git",
      ["archive", "--format=tar", baseRef, "--", ...existing],
      { cwd, timeout: ARCHIVE_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
      (error, stdoutBuffer) => {
        if (error) {
          reject(error);
          return;
        }

        const extract = execFile(
          "tar",
          ["-x", "-C", dir],
          { timeout: ARCHIVE_TIMEOUT_MS },
          (tarError) => (tarError ? reject(tarError) : resolve()),
        );

        extract.stdin?.end(stdoutBuffer);
      },
    );

    archive.on("error", reject);
  });

  return { dir, files: existing, cleanup };
}
