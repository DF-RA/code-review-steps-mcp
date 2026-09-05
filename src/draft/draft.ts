import { renderComment, type ReviewComment } from "../review/comments.js";

export const DRAFT_STATUSES = ["pending", "valid", "discarded", "rework"] as const;

/**
 * What the user decided about a comment.
 *
 * "rework" is the interesting one: the comment says something worth saying but
 * not the way it says it, so it goes back to the agent with a note instead of
 * being thrown away.
 */
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type DraftComment = {
  id: string;
  scope: ReviewComment["scope"];
  severity: ReviewComment["severity"];
  path?: string;
  line?: number;
  endLine?: number;
  title: string;
  /** Editable in the page; this is what gets published. */
  body: string;
  status: DraftStatus;
  /** What the user asked to change, when status is "rework". */
  note?: string;
  edited: boolean;
};

export type Draft = {
  comments: DraftComment[];
  /** Set from the page when the user is done reviewing the draft. */
  confirmed: boolean;
  createdAt: number;
};

export function toDraftComment(comment: ReviewComment, id: string): DraftComment {
  return {
    id,
    scope: comment.scope,
    severity: comment.severity,
    path: comment.path,
    line: comment.line,
    endLine: comment.endLine,
    title: comment.title,
    body: comment.body,
    status: "pending",
    edited: false,
  };
}

/** The comment as it would be published, with the edits applied. */
export function renderDraftComment(comment: DraftComment): string {
  return renderComment({
    scope: comment.scope,
    severity: comment.severity,
    path: comment.path,
    line: comment.line,
    endLine: comment.endLine,
    title: comment.title,
    body: comment.body,
  });
}

export function countByStatus(draft: Draft): Record<DraftStatus, number> {
  const counts: Record<DraftStatus, number> = {
    pending: 0,
    valid: 0,
    discarded: 0,
    rework: 0,
  };

  for (const comment of draft.comments) {
    counts[comment.status] += 1;
  }

  return counts;
}
