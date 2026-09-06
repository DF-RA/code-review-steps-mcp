import { UserFacingError } from "../errors.js";
import { runGh } from "./gh.js";
import {
  parsePullRequestRef,
  resolveRepoTarget,
  type RepoTarget,
} from "./repo-target.js";

/** A pull request already resolved to a number and a place to look it up. */
export interface PrLocation {
  number: number;
  target: RepoTarget;
}

export async function locatePullRequest(
  pr: string | number,
  repo?: string,
): Promise<PrLocation> {
  const ref = parsePullRequestRef(pr);

  // A pull request URL carries its own repository, so it wins over `repo`.
  const target: RepoTarget = ref.slug
    ? { kind: "slug", slug: ref.slug }
    : await resolveRepoTarget(repo);

  return { number: ref.number, target };
}

export async function queryPullRequest<T>(
  location: PrLocation,
  fields: string,
): Promise<T> {
  const { number, target } = location;
  const args = ["pr", "view", String(number), "--json", fields];

  if (target.kind === "slug") {
    args.push("--repo", target.slug);
  }

  const stdout = await runGh(args, target.kind === "path" ? target.cwd : undefined);

  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new UserFacingError("No se pudo interpretar la respuesta de `gh` como JSON.");
  }
}

/** Only open pull requests are worth reviewing. */
export function assertReviewable(prNumber: number, state?: string): void {
  if (state && state !== "OPEN") {
    throw new UserFacingError(
      `El PR #${prNumber} está en estado ${state}. Solo se revisan pull requests abiertos.`,
    );
  }
}

export interface BranchOverrides {
  baseBranch?: string;
  headBranch?: string;
}

export interface PrBranches {
  baseBranch: string;
  headBranch: string;
}

/**
 * Branches of the pull request, asking GitHub only for what the caller did not
 * already provide.
 */
export async function resolveBranches(
  location: PrLocation,
  overrides: BranchOverrides = {},
): Promise<PrBranches> {
  if (overrides.baseBranch && overrides.headBranch) {
    return { baseBranch: overrides.baseBranch, headBranch: overrides.headBranch };
  }

  const raw = await queryPullRequest<{
    state?: string;
    baseRefName?: string;
    headRefName?: string;
  }>(location, "state,baseRefName,headRefName");

  assertReviewable(location.number, raw.state);

  const baseBranch = overrides.baseBranch ?? raw.baseRefName;
  const headBranch = overrides.headBranch ?? raw.headRefName;

  if (!baseBranch || !headBranch) {
    throw new UserFacingError(
      "GitHub no devolvió las ramas del pull request, así que no se puede construir el rango de comparación.",
    );
  }

  return { baseBranch, headBranch };
}
