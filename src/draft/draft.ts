import { renderComment, type ReviewComment } from "../review/comments.js";

export const DRAFT_STATUSES = ["pending", "valid", "discarded", "rework"] as const;

/**
 * What the user decided about a comment.
 *
 * "rework" is the interesting one: the comment says something worth saying but
 * not the way it says it, so it goes back to the agent instead of being thrown
 * away. Marking it is the whole message; what to change is something the agent
 * asks about when it gets there, in the conversation, where the person can
 * answer in as many words as it takes.
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
