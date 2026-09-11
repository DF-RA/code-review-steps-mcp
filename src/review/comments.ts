export const COMMENT_SCOPES = ["line", "file", "pr"] as const;

/**
 * Where a comment hangs.
 *
 * "line" is the default and what makes the review easy to follow: one comment
 * per point, anchored to the code it talks about. "file" is for what concerns
 * the whole file and cannot be pinned to a line, and "pr" for what belongs to no
 * file at all, like a failing pipeline.
 */
export type CommentScope = (typeof COMMENT_SCOPES)[number];

export const COMMENT_SEVERITIES = ["blocker", "issue", "suggestion", "question"] as const;

export type CommentSeverity = (typeof COMMENT_SEVERITIES)[number];

/* Type alias, not interface: comments travel in structuredContent. */
export type ReviewComment = {
  scope: CommentScope;
  /** Absent only on scope "pr". */
  path?: string;
  /** Only on scope "line". */
  line?: number;
  endLine?: number;
  severity: CommentSeverity;
  /** One line, what is wrong. */
  title: string;
  /** The explanation, and what to do about it. */
  body: string;
  /** Role that raised it: programador, qa, arquitecto, product, lider. */
  raisedBy?: string;
};

export const SIGNATURE_ENV_VAR = "CODE_REVIEW_MCP_SIGNATURE";

const DEFAULT_SIGNATURE = "Powered by Claude Code";

export function signature(): string {
  return process.env[SIGNATURE_ENV_VAR]?.trim() || DEFAULT_SIGNATURE;
}

const MARK: Record<CommentSeverity, string> = {
  blocker: "🛑 Bloqueante",
  issue: "⚠️ Problema",
  suggestion: "💡 Sugerencia",
  question: "❓ Duda",
};

/**
 * GitHub alerts, which render the blockquote with a colour and an icon of their
 * own. It is the only way to get colour into a comment: GitHub markdown has no
 * styling, and an image badge would be one more request for whoever reads it.
 */
const ALERT: Record<CommentSeverity, string> = {
  blocker: "CAUTION",
  issue: "WARNING",
  suggestion: "TIP",
  question: "NOTE",
};

/** Alerts cannot be nested, so the whole comment goes inside one blockquote. */
function quote(lines: string[]): string {
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

function location(comment: ReviewComment): string {
  if (comment.scope === "pr") {
    return "";
  }

  if (comment.scope === "file" || comment.line === undefined) {
    return `\`${comment.path}\``;
  }

  const lines =
    comment.endLine && comment.endLine !== comment.line
      ? `L${comment.line}-${comment.endLine}`
      : `L${comment.line}`;

  return `\`${comment.path}\` ${lines}`;
}

/**
 * Renders one comment ready to be posted.
 * The signature is not decoration: whoever reads this in a pull request has to
 * know it was written by a machine before deciding how much to trust it.
 */
export function renderComment(comment: ReviewComment): string {
  const where = location(comment);
  const heading = [MARK[comment.severity], comment.title].join(" — ");

  // The label stays inside the alert even though the alert has its own icon:
  // it keeps the severity readable where the alert is not rendered, such as a
  // terminal or a diff of the raw text.
  //
  // The body is split: quote() prefixes each element, so a body with more than
  // one line would leave every line after the first outside the blockquote, and
  // an alert cannot be reopened.
  const inside = [
    `**${heading}**`,
    ...(where ? [where] : []),
    "",
    ...comment.body.trim().split("\n"),
  ];

  return [`> [!${ALERT[comment.severity]}]`, quote(inside), "", `_${signature()}_`].join("\n");
}
