/**
 * The piece of code a comment points at, cut out of the diff.
 *
 * A comment reads very differently next to the line it talks about, which is
 * why GitHub shows the hunk above every review comment. The draft page is where
 * the person decides whether each comment goes out, and until now it made them
 * decide with the file name and a line number alone.
 */

import { flavorOf, highlight, type Token } from "./highlight.js";

export const SNIPPET_CONTEXT = 3;

/** Room enough for a long range without turning the card into the whole file. */
const MAX_SNIPPET_LINES = 40;

export type SnippetKind = "added" | "removed" | "context";

export type SnippetLine = {
  kind: SnippetKind;
  /** Line number on the new side. Absent on a removed line, which has none. */
  number?: number;
  /** The line already coloured: the page only has to paint what it is given. */
  tokens: Token[];
  /** Whether the comment points at this very line. */
  target: boolean;
};

export type Snippet = {
  lines: SnippetLine[];
  /** Set when the range was longer than what the card shows. */
  truncated: boolean;
  /**
   * Whether the comment can hang from that line when it is published.
   *
   * A hunk also carries the lines around the change, and a comment can point at
   * one of those: it is shown, because it is code worth reading, but publishing
   * it inline is not possible — publish_review turns it into a file comment,
   * and the page has to say so before the person decides.
   */
  anchored: boolean;
};

interface Hunk {
  /** First line number of the hunk on the new side. */
  start: number;
  /** Body of the hunk, markers included. */
  body: string[];
}

/** Splits the diff of one file into its hunks, with their new-side start. */
function hunksOf(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  const lines = diff.split("\n");

  // The newline that closes the diff, not a line of it: left in, it becomes an
  // empty context line hanging under every hunk. An empty line in the middle is
  // a real one, so only the last is dropped.
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (const line of lines) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);

    if (header?.[1]) {
      current = { start: Number(header[1]), body: [] };
      hunks.push(current);
      continue;
    }

    // Everything before the first @@ is the file header, and "\ No newline at
    // end of file" is a note about the diff, not a line of the file.
    if (current && !line.startsWith("\\")) {
      current.body.push(line);
    }
  }

  return hunks;
}

interface Walked {
  kind: SnippetKind;
  number?: number;
  text: string;
  /** Where the line sits on the new side, for a removed line too. */
  at: number;
}

/**
 * Walks a hunk assigning each line its number on the new side.
 * A removed line has no number of its own, so it takes the position of the line
 * that follows it: that is where it belongs on screen.
 */
function walk(hunk: Hunk): Walked[] {
  const walked: Walked[] = [];
  let number = hunk.start;

  for (const raw of hunk.body) {
    // An empty context line reaches us as "" when the diff loses its trailing
    // space, so what is not a marker is context.
    const marker = raw.startsWith("+") || raw.startsWith("-") ? raw[0] : " ";
    const text = marker === " " ? raw.replace(/^ /, "") : raw.slice(1);

    if (marker === "-") {
      walked.push({ kind: "removed", text, at: number });
      continue;
    }

    walked.push({ kind: marker === "+" ? "added" : "context", number, text, at: number });
    number += 1;
  }

  return walked;
}

/**
 * The lines around what a comment points at, as the diff shows them.
 *
 * Undefined when the pull request does not touch that line: there is no hunk to
 * cut from, and that is the same comment publish_review has to turn into a file
 * comment, so the page says as much instead of inventing a piece of code.
 */
export function snippetFor(
  diff: string,
  path: string,
  line: number,
  endLine?: number,
  context = SNIPPET_CONTEXT,
): Snippet | undefined {
  const last = endLine && endLine > line ? endLine : line;

  for (const hunk of hunksOf(diff)) {
    const walked = walk(hunk);
    const covers = walked.some((entry) => entry.number === line);

    if (!covers) {
      continue;
    }

    // Coloured over the whole hunk and cut afterwards: a doc comment that opens
    // above the window still has to paint the lines inside it as a comment.
    const coloured = highlight(
      walked.map((entry) => entry.text),
      flavorOf(path),
    );

    // Only the hunk holding the line is cut: a window reaching into the next
    // one would show two pieces of code as if they were contiguous.
    const from = line - context;
    const to = last + context;
    const lines: SnippetLine[] = walked
      .map((entry, index) => ({ entry, tokens: coloured[index] ?? [] }))
      .filter(({ entry }) => entry.at >= from && entry.at <= to)
      .map(({ entry, tokens }) => ({
        kind: entry.kind,
        number: entry.number,
        tokens,
        target: entry.number !== undefined && entry.number >= line && entry.number <= last,
      }));

    return {
      lines: lines.slice(0, MAX_SNIPPET_LINES),
      truncated: lines.length > MAX_SNIPPET_LINES,
      // The same rule publish_review applies: only a line the pull request
      // added or changed takes an inline comment.
      anchored: lines.some((entry) => entry.number === line && entry.kind === "added"),
    };
  }

  return undefined;
}
