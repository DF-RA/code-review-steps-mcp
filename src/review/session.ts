import { randomUUID } from "node:crypto";

import type { Finding } from "../analysis/types.js";
import type { ChangedFile } from "../changed-files.js";
import type { ReviewComment } from "./comments.js";
import type { Draft } from "../draft/draft.js";
import type { FixItem } from "./fixes.js";
import type { TaskContext } from "./task-context.js";
import { UserFacingError } from "../errors.js";
import { findReviewById, saveReview } from "./db.js";

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
  /**
   * Head commit as GitHub reported it when the review opened. Frozen next to
   * headSha so a later look at the same pull request can tell whether it moved.
   */
  headRefOid: string;
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

/**
 * What step 1 produced lives in SQLite; this map only caches the sessions in
 * flight, because the later steps still hold their state in memory. Dropping an
 * entry therefore costs the work of those steps, never the review itself: the
 * next lookup rebuilds it from the row.
 */
const IDLE_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

const sessions = new Map<string, ReviewSession>();
const lastUsed = new Map<string, number>();

function touch(id: string): void {
  lastUsed.set(id, Date.now());
}

function forget(id: string): void {
  sessions.delete(id);
  lastUsed.delete(id);
}

/**
 * Evicts by time since last use, not since creation: a review sitting at step 7
 * while someone reads the draft is being used, and must not be dropped for
 * having started long ago.
 */
function prune(): void {
  const now = Date.now();

  for (const id of [...sessions.keys()]) {
    if (now - (lastUsed.get(id) ?? 0) > IDLE_MS) {
      forget(id);
    }
  }

  while (sessions.size >= MAX_SESSIONS) {
    const coldest = [...lastUsed.entries()].sort((a, b) => a[1] - b[1])[0];

    if (!coldest) {
      break;
    }
    forget(coldest[0]);
  }
}

function remember(session: ReviewSession): ReviewSession {
  prune();
  sessions.set(session.id, session);
  touch(session.id);
  saveReview(session);

  return session;
}

export function createSession(data: Omit<ReviewSession, "id" | "createdAt">): ReviewSession {
  return remember({ ...data, id: randomUUID(), createdAt: Date.now() });
}

/** Puts a session restored from a file back into play, under its own id. */
export function adoptSession(session: ReviewSession): ReviewSession {
  return remember(session);
}

/** Every step starts here, so a missing session says what to do. */
export function requireSession(reviewId: string): ReviewSession {
  const id = reviewId.trim();
  const cached = sessions.get(id);

  if (cached) {
    touch(id);

    return cached;
  }

  const stored = findReviewById(id);

  if (!stored) {
    throw new UserFacingError(
      `No hay ninguna revisión con id "${reviewId}". Empieza por start_review.`,
    );
  }

  // Rebuilt from the row: what the later steps had in memory is not in it.
  prune();
  sessions.set(stored.id, stored);
  touch(stored.id);

  return stored;
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
