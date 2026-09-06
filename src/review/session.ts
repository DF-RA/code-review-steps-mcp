import { randomUUID } from "node:crypto";

import type { Finding } from "../analysis/types.js";
import type { ChangedFile } from "../changed-files.js";
import type { ReviewComment } from "./comments.js";
import type { Draft } from "../draft/draft.js";
import type { FixItem } from "./fixes.js";
import type { TaskContext } from "./task-context.js";
import { UserFacingError } from "../errors.js";

/**
 * State of one review, shared by every step.
 *
 * The steps are a sequence, not four independent tools: each one leaves what it
 * produced here and the next one reads it. That is what makes the flow
 * deterministic — every step sees exactly the same commits and the same files,
 * and a step cannot run before the one that feeds it.
 */
export interface ReviewSession {
  id: string;
  prNumber: number;
  title: string;
  /** Description written by the author. May be empty. */
  body: string;
  url: string;
  author: string;
  /** Local clone. Every step works against this checkout. */
  repoPath: string;
  targetBranch: string;
  sourceBranch: string;
  /**
   * Commits resolved once, at the start. A push to the pull request midway
   * cannot make one step see different code than another.
   */
  baseSha: string;
  headSha: string;
  range: string;
  createdAt: number;

  /** Step 2. */
  files?: ChangedFile[];
  /** Step 2. Resolved once for the whole review. */
  taskContext?: TaskContext;
  /** Step 9b: the approved comments turned into work to do. */
  fixes?: FixItem[];
  /** Step 7, built from the comments of step 6. */
  draft?: Draft;
  /** Step 6, one entry per file the agent reviewed. */
  reviews?: Map<string, ReviewComment[]>;
  /** Step 3. */
  analysis?: {
    tools: string[];
    skipped: { tool: string; reason: string }[];
    findingsByFile: Map<string, Finding[]>;
    /** Files no analyzer covers, so the agent knows nobody looked at them. */
    unanalyzed: string[];
  };
}

const TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

const sessions = new Map<string, ReviewSession>();

function prune(): void {
  const now = Date.now();

  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL_MS) {
      sessions.delete(id);
    }
  }

  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next();

    if (oldest.done) {
      break;
    }
    sessions.delete(oldest.value);
  }
}

export function createSession(data: Omit<ReviewSession, "id" | "createdAt">): ReviewSession {
  prune();

  const session: ReviewSession = { ...data, id: randomUUID(), createdAt: Date.now() };
  sessions.set(session.id, session);

  return session;
}

/** Puts a session restored from a file back into play, under its own id. */
export function adoptSession(session: ReviewSession): ReviewSession {
  prune();
  sessions.set(session.id, session);

  return session;
}

/** Every step starts here, so a missing or expired session says what to do. */
export function requireSession(reviewId: string): ReviewSession {
  const session = sessions.get(reviewId.trim());

  if (!session) {
    throw new UserFacingError(
      `No hay ninguna revisión con id "${reviewId}". Empieza por start_review; las revisiones caducan a las 4 horas.`,
    );
  }

  return session;
}

export function requireTaskContext(session: ReviewSession): TaskContext {
  if (!session.taskContext) {
    throw new UserFacingError(
      "Todavía no se ha buscado el contexto de la tarea. Usa el prompt task_context con este reviewId y registra el resultado con record_task_context; si no hay tarea o el gestor no está disponible, regístralo igual con found: false.",
    );
  }

  return session.taskContext;
}

export function requireFiles(session: ReviewSession): ChangedFile[] {
  if (!session.files) {
    throw new UserFacingError(
      "Todavía no se sabe qué archivos toca el PR. Llama antes a get_pr_files con este reviewId.",
    );
  }

  return session.files;
}

export function requireAnalysis(session: ReviewSession): NonNullable<ReviewSession["analysis"]> {
  if (!session.analysis) {
    throw new UserFacingError(
      "Todavía no se ha analizado el PR. Llama antes a analyze_pr con este reviewId.",
    );
  }

  return session.analysis;
}
