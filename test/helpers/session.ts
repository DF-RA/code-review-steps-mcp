import type { ReviewSession } from "../../src/review/session.js";

/** A session as start_review leaves it: opened, with no step done yet. */
export function sessionData(
  overrides: Partial<Omit<ReviewSession, "id" | "createdAt">> = {},
): Omit<ReviewSession, "id" | "createdAt"> {
  return {
    prNumber: 200,
    title: "Añade el rechazo con items",
    body: "Descripción del PR.",
    url: "https://github.com/acme/tienda/pull/200",
    author: "alguien",
    repoPath: "/home/me/clones/tienda",
    targetBranch: "main",
    sourceBranch: "feature/rechazo",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    headRefOid: "b".repeat(40),
    range: "origin/main...origin/feature/rechazo",
    ...overrides,
  };
}
