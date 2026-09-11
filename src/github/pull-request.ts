import { GhError, runGh } from "./gh.js";
import {
  parsePullRequestRef,
  resolveRepoTarget,
  type RepoTarget,
} from "./repo-target.js";

const PR_FIELDS = [
  "number",
  "title",
  "body",
  "url",
  "state",
  "isDraft",
  "author",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "statusCheckRollup",
] as const;

export const PIPELINE_STATUSES = ["passing", "failing", "pending", "none"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/*
 * These three are type aliases, not interfaces: the SDK types structuredContent
 * as an index signature, and only type aliases are assignable to one.
 */
export type CheckSummary = {
  name: string;
  url?: string;
};

export type PipelineSummary = {
  status: PipelineStatus;
  total: number;
  /** Only the checks that failed: a green pipeline needs no detail. */
  failed: CheckSummary[];
};

export type PullRequestInfo = {
  number: number;
  title: string;
  /** Description written by the author. May be empty. */
  body: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  /**
   * Head commit as GitHub sees it right now. Compared against the sha frozen in
   * a review, it is what tells apart "the clone is behind" from "the pull
   * request moved since we reviewed it".
   */
  headRefOid: string;
  pipeline: PipelineSummary;
};

/**
 * GitHub mixes two shapes inside statusCheckRollup: Actions check runs
 * (status + conclusion) and legacy status contexts (state).
 */
interface RawCheck {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

interface RawPullRequest {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  author?: { login?: string } | null;
  headRefName?: string;
  headRefOid?: string;
  baseRefName?: string;
  statusCheckRollup?: RawCheck[] | null;
}

type Outcome = "success" | "failure" | "pending";

/** Conclusions that are not a failure even though the check did not pass. */
const NON_FAILURE_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

function outcomeOf(check: RawCheck): Outcome {
  // Legacy status context.
  if (check.__typename === "StatusContext" || (!check.status && !check.conclusion && check.state)) {
    const state = (check.state ?? "").toUpperCase();

    if (state === "SUCCESS") {
      return "success";
    }
    return PENDING_STATES.has(state) ? "pending" : "failure";
  }

  // Actions check run: not finished yet means pending, whatever the conclusion.
  if ((check.status ?? "").toUpperCase() !== "COMPLETED") {
    return "pending";
  }

  return NON_FAILURE_CONCLUSIONS.has((check.conclusion ?? "").toUpperCase())
    ? "success"
    : "failure";
}

function summarizePipeline(checks: RawCheck[]): PipelineSummary {
  if (checks.length === 0) {
    return { status: "none", total: 0, failed: [] };
  }

  const failed: CheckSummary[] = [];
  let pending = false;

  for (const check of checks) {
    const outcome = outcomeOf(check);

    if (outcome === "failure") {
      failed.push({
        name: check.name ?? check.context ?? "check sin nombre",
        url: check.detailsUrl ?? check.targetUrl,
      });
    } else if (outcome === "pending") {
      pending = true;
    }
  }

  let status: PipelineStatus = "passing";
  if (failed.length > 0) {
    status = "failing";
  } else if (pending) {
    status = "pending";
  }

  return { status, total: checks.length, failed };
}

function toPullRequestInfo(raw: RawPullRequest): PullRequestInfo {
  return {
    number: raw.number ?? 0,
    title: raw.title ?? "",
    body: (raw.body ?? "").trim(),
    url: raw.url ?? "",
    state: raw.state ?? "UNKNOWN",
    isDraft: raw.isDraft ?? false,
    author: raw.author?.login ?? "desconocido",
    sourceBranch: raw.headRefName ?? "",
    targetBranch: raw.baseRefName ?? "",
    headRefOid: raw.headRefOid ?? "",
    pipeline: summarizePipeline(raw.statusCheckRollup ?? []),
  };
}

export async function fetchPullRequest(
  pr: string | number,
  repo?: string,
): Promise<PullRequestInfo> {
  const ref = parsePullRequestRef(pr);

  // A pull request URL carries its own repository, so it wins over `repo`.
  const target: RepoTarget = ref.slug
    ? { kind: "slug", slug: ref.slug }
    : await resolveRepoTarget(repo);

  const args = ["pr", "view", String(ref.number), "--json", PR_FIELDS.join(",")];

  if (target.kind === "slug") {
    args.push("--repo", target.slug);
  }

  const stdout = await runGh(args, target.kind === "path" ? target.cwd : undefined);

  try {
    return toPullRequestInfo(JSON.parse(stdout) as RawPullRequest);
  } catch {
    throw new GhError("No se pudo interpretar la respuesta de `gh` como JSON.");
  }
}
