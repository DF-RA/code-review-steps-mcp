import { UserFacingError } from "./errors.js";
import { runGit } from "./git/git.js";

/** Line budget of one part. A single hunk bigger than this is still sent whole. */
const MAX_LINES_PER_PART = 2000;

export type FileDiff = {
  path: string;
  diff: string;
  /** Index of the first hunk included in this part. */
  offset: number;
  hunksIncluded: number;
  totalHunks: number;
  hasMore: boolean;
  /** Offset to ask for the next part. Absent when this is the last one. */
  nextOffset?: number;
};

/**
 * Splits the diff into lines, dropping only the trailing newline.
 * trimEnd() must not be used: a blank context line is a single space, and
 * trimming it deletes real content from the diff.
 */
function toLines(diff: string): string[] {
  const lines = diff.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Splits a unified diff into its file header and its hunks.
 * Hunks start at @@; everything before the first one is the header that every
 * part has to repeat to stay readable on its own.
 */
function splitHunks(diff: string): { header: string[]; hunks: string[][] } {
  const header: string[] = [];
  const hunks: string[][] = [];
  let current: string[] | undefined;

  for (const line of toLines(diff)) {
    if (line.startsWith("@@")) {
      current = [line];
      hunks.push(current);
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      header.push(line);
    }
  }

  return { header, hunks };
}

interface Part {
  diff: string;
  offset: number;
  hunksIncluded: number;
  totalHunks: number;
  hasMore: boolean;
  nextOffset?: number;
}

/** Takes whole hunks from `offset` until the line budget is spent. */
function takePart(diff: string, offset: number, path: string): Part {
  const { header, hunks } = splitHunks(diff);

  if (offset > 0 && offset >= hunks.length) {
    throw new UserFacingError(
      `El diff de "${path}" solo tiene ${hunks.length} bloque(s), así que no hay nada en la posición ${offset}.`,
    );
  }

  const selected: string[][] = [];
  let used = header.length;
  let index = offset;

  while (index < hunks.length) {
    const hunk = hunks[index];

    if (!hunk) {
      break;
    }

    // Always take at least one hunk: otherwise a huge hunk would stall the walk.
    if (selected.length > 0 && used + hunk.length > MAX_LINES_PER_PART) {
      break;
    }

    selected.push(hunk);
    used += hunk.length;
    index += 1;
  }

  const hasMore = index < hunks.length;

  return {
    diff: [...header, ...selected.flat()].join("\n"),
    offset,
    hunksIncluded: selected.length,
    totalHunks: hunks.length,
    hasMore,
    nextOffset: hasMore ? index : undefined,
  };
}

/**
 * The whole diff of one file, as git prints it.
 *
 * Split out from the slicing so a caller that already has the text — because it
 * was stored the first time — can cut a part from it without asking git again.
 */
export async function rawFileDiff(cwd: string, range: string, path: string): Promise<string> {
  // The -- separator keeps git from reading the path as a ref.
  const stdout = await runGit(["diff", range, "--", path], cwd);

  if (stdout.trim().length === 0) {
    throw new UserFacingError(`El rango ${range} no muestra cambios en "${path}".`);
  }

  return stdout;
}

/** One part of a whole diff, cut at hunk boundaries. */
export function partOf(diff: string, path: string, offset = 0): FileDiff {
  return { path, ...takePart(diff, offset, path) };
}

/** How many hunks the whole diff has, without cutting a part out of it. */
export function countHunks(diff: string): number {
  return splitHunks(diff).hunks.length;
}

/** Full diff of one file, in parts cut at hunk boundaries. */
export async function fileDiff(
  cwd: string,
  range: string,
  path: string,
  offset = 0,
): Promise<FileDiff> {
  return partOf(await rawFileDiff(cwd, range, path), path, offset);
}
