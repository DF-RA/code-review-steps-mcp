/**
 * What the pull request was supposed to do, according to the tracker.
 *
 * Resolved once per review, right after opening it: the task is the same for
 * every file, and asking again per file would waste calls and could even give
 * different answers midway through the review.
 */
export type TaskContext = {
  found: boolean;
  /** Why there is no context. Only when found is false. */
  reason?: string;
  /** Task code as it appears in the title, e.g. PROJ-1234. */
  code?: string;
  title?: string;
  /** What the task asks for, in the agent's own words. */
  summary?: string;
  url?: string;
};
