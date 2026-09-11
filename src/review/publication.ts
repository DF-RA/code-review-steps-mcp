import { renderDraftComment, type DraftComment } from "../draft/draft.js";

/**
 * A comment anchored to lines of the diff.
 *
 * Shaped exactly as the review endpoint takes it: what GitHub does not accept
 * there cannot be represented, so a payload that type-checks is a payload the
 * API will read.
 */
export interface InlineComment {
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
}

/**
 * A comment on a whole file.
 *
 * It travels apart because the review endpoint has no way to express it: only
 * the single-comment endpoint takes `subject_type`, and sending it inside a
 * review makes GitHub reject the review whole, with every other comment in it.
 */
export interface FileComment {
  path: string;
  body: string;
}

export interface Publication {
  /** Body of the review: what belongs to no file. */
  body: string;
  inline: InlineComment[];
  files: FileComment[];
  /** Line comments that had to become file comments, to say so before publishing. */
  demoted: string[];
}

/** True when every line of the range is one the diff touches. */
function rangeIsInDiff(changed: Set<number>, from: number, to: number): boolean {
  for (let line = from; line <= to; line += 1) {
    if (!changed.has(line)) {
      return false;
    }
  }

  return true;
}

/**
 * Splits the approved comments into what each GitHub endpoint can take.
 *
 * `lines` is what the diff touches on the new side, by file: GitHub rejects an
 * inline comment on anything else, and rejects the whole review with it, so a
 * comment that does not fit is moved rather than sent to fail.
 */
export function buildPublication(
  comments: DraftComment[],
  lines: Map<string, Set<number>>,
): Publication {
  const inline: InlineComment[] = [];
  const files: FileComment[] = [];
  const prLevel: string[] = [];
  const demoted: string[] = [];

  for (const comment of comments) {
    const rendered = renderDraftComment(comment);

    if (comment.scope === "pr" || !comment.path) {
      prLevel.push(rendered);
      continue;
    }

    if (comment.scope === "file" || comment.line === undefined) {
      files.push({ path: comment.path, body: rendered });
      continue;
    }

    const changed = lines.get(comment.path);

    // A line the pull request did not touch would be rejected by the API, so it
    // becomes a file comment instead of losing the whole publication.
    if (!changed?.has(comment.line)) {
      demoted.push(`${comment.path} L${comment.line} — ${comment.title}`);
      files.push({
        path: comment.path,
        body: `${rendered}\n\n_(sobre la línea ${comment.line}, que no forma parte del diff)_`,
      });
      continue;
    }

    const entry: InlineComment = {
      path: comment.path,
      line: comment.line,
      side: "RIGHT",
      body: rendered,
    };

    // A range is only worth asking for when the diff touches all of it: GitHub
    // takes a multi-line comment inside one hunk and no further. When it does
    // not fit, the comment still lands on its first line instead of failing.
    if (
      comment.endLine &&
      comment.endLine > comment.line &&
      rangeIsInDiff(changed, comment.line, comment.endLine)
    ) {
      entry.start_line = comment.line;
      entry.start_side = "RIGHT";
      entry.line = comment.endLine;
    }

    inline.push(entry);
  }

  const body = [
    "## Revisión automática",
    "",
    ...(prLevel.length > 0 ? [prLevel.join("\n\n")] : ["Los comentarios van en las líneas del diff."]),
  ].join("\n");

  return { body, inline, files, demoted };
}
