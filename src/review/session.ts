import { randomUUID } from "node:crypto";

import type { Finding } from "../analysis/types.js";
import type { ChangedFile } from "../changed-files.js";
import type { ReviewComment } from "./comments.js";
import type { Draft } from "../draft/draft.js";
import type { FixItem } from "./fixes.js";
import type { TaskContext } from "./task-context.js";
import { UserFacingError } from "../errors.js";
import {
  findAnalysis,
  findDraft,
  findFileReviews,
  findFixes,
  findReviewById,
  findReviewFiles,
  findTaskContext,
  hasTaskContext,
  resetReviewSteps,
  saveReview,
} from "./db.js";

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
 * Every step reads the review back from SQLite.
 *
 * There is no cache: the rows are the review, and a session object is a view of
 * them built for one call. Two callers therefore cannot disagree about what a
 * review holds, and nothing is lost when this process ends — which is what the
 * page of the draft depends on, since it is written by a browser and read by a
 * tool that may run much later.
 */
export function createSession(data: Omit<ReviewSession, "id" | "createdAt">): ReviewSession {
  const session: ReviewSession = { ...data, id: randomUUID(), createdAt: Date.now() };

  // Only step 1 has run, so the row is the whole of it; every later step writes
  // its own table as it goes.
  saveReview(session);

  return session;
}

/** Puts a review back to just after step 1. */
export function restartSteps(session: ReviewSession): void {
  resetReviewSteps(session.id);

  session.taskContext = undefined;
  session.files = undefined;
  session.analysis = undefined;
  session.reviews = undefined;
  session.draft = undefined;
  session.fixes = undefined;
}

/** Every step starts here, so a missing review says what to do. */
export function requireSession(reviewId: string): ReviewSession {
  const id = reviewId.trim();
  const stored = findReviewById(id);

  if (!stored) {
    throw new UserFacingError(
      `No hay ninguna revisión con id "${reviewId}". Empieza por start_review.`,
    );
  }

  return {
    ...stored,
    taskContext: findTaskContext(id),
    files: findReviewFiles(id),
    analysis: findAnalysis(id),
    reviews: findFileReviews(id),
    draft: findDraft(id),
    fixes: findFixes(id),
  };
}

export function requireTaskContext(session: ReviewSession): TaskContext {
  if (!session.taskContext) {
    throw new UserFacingError(
      "Todavía no se ha buscado el contexto de la tarea. Usa el prompt task_context con este reviewId y registra el resultado con record_task_context; si no hay tarea o el gestor no está disponible, regístralo igual con found: false.",
    );
  }

  return session.taskContext;
}

/**
 * Step 2 is a prerequisite of step 3 by order, not by data: nothing there reads
 * what the task said. So the guard asks the database whether it was recorded
 * and stops at that, instead of loading a context it will not look at.
 */
export function requireRecordedTaskContext(reviewId: string): void {
  if (!hasTaskContext(reviewId)) {
    throw new UserFacingError(
      "Todavía no se ha buscado el contexto de la tarea. Usa el prompt task_context con este reviewId y registra el resultado con record_task_context; si no hay tarea o el gestor no está disponible, regístralo igual con found: false.",
    );
  }
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
