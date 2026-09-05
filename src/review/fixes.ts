export const FIX_STATUSES = ["pending", "done", "skipped"] as const;

export type FixStatus = (typeof FIX_STATUSES)[number];

/**
 * A comment turned into work to do.
 *
 * This is the path for when you own the pull request: instead of publishing the
 * comments for someone else to read, you walk them one by one and fix them.
 */
export type FixItem = {
  id: string;
  path?: string;
  line?: number;
  endLine?: number;
  severity: string;
  title: string;
  body: string;
  status: FixStatus;
  /** What was done about it, or why it was skipped. */
  note?: string;
};

export function countFixes(fixes: FixItem[]): Record<FixStatus, number> {
  const counts: Record<FixStatus, number> = { pending: 0, done: 0, skipped: 0 };

  for (const fix of fixes) {
    counts[fix.status] += 1;
  }

  return counts;
}
