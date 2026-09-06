import { extractBaseVersion } from "./analysis/baseline.js";
import { changedLinesByFile } from "./analysis/changed-lines.js";
import { planAnalysis } from "./analysis/registry.js";
import {
  AnalyzerUnavailableError,
  SEVERITIES,
  fingerprint,
  type Analyzer,
  type Finding,
  type Severity,
} from "./analysis/types.js";
import { UserFacingError } from "./errors.js";
import { runGit } from "./git/git.js";

export type SkippedAnalyzer = {
  tool: string;
  reason: string;
};

export type PullRequestAnalysis = {
  tools: string[];
  skipped: SkippedAnalyzer[];
  findingsByFile: Map<string, Finding[]>;
  /** Files of the PR that no analyzer covers. */
  unanalyzed: string[];
};

const SEVERITY_ORDER = new Map<Severity, number>(
  SEVERITIES.map((severity, index) => [severity, index]),
);

interface AnalyzerOutcome {
  analyzer: Analyzer;
  findings?: Finding[];
  skipped?: SkippedAnalyzer;
}

async function runAnalyzer(
  analyzer: Analyzer,
  cwd: string,
  files: string[],
): Promise<AnalyzerOutcome> {
  try {
    return { analyzer, findings: await analyzer.run({ cwd, files }) };
  } catch (error) {
    // A missing or failing tool must not sink the analysis of the others.
    if (error instanceof AnalyzerUnavailableError) {
      return { analyzer, skipped: { tool: analyzer.name, reason: error.hint } };
    }

    const reason = error instanceof UserFacingError ? error.message : String(error);

    return { analyzer, skipped: { tool: analyzer.name, reason } };
  }
}

/**
 * Removes the findings that already existed at the base revision.
 * Compares by multiset: three occurrences before and four after means one new,
 * even though every one of them looks identical.
 */
function subtractBaseline(after: Finding[], before: Finding[]): Finding[] {
  const remaining = new Map<string, number>();

  for (const finding of before) {
    const key = fingerprint(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  return after.filter((finding) => {
    const key = fingerprint(finding);
    const count = remaining.get(key) ?? 0;

    if (count === 0) {
      return true;
    }

    remaining.set(key, count - 1);
    return false;
  });
}

/**
 * Runs the analyzers over the files of a pull request, once.
 *
 * The analyzers need whole files: PMD or Ruff cannot parse a diff. What isolates
 * the pull request is the subtraction against the base version of each file, not
 * feeding them a smaller piece of it.
 */
export async function analyzePullRequest(
  cwd: string,
  baseRef: string,
  range: string,
  paths: string[],
): Promise<PullRequestAnalysis> {
  // Deleted files are gone from the working tree; analyzers would fail on them.
  // -z keeps git from quoting paths with spaces or non-ASCII characters, which
  // would then match none of the paths of the pull request.
  const listing = await runGit(
    ["ls-tree", "-r", "--name-only", "-z", range.split("...")[1] ?? "HEAD"],
    cwd,
  ).catch(() => "");
  const inHead = new Set(listing.split("\0").filter(Boolean));
  const present = inHead.size > 0 ? paths.filter((path) => inHead.has(path)) : paths;

  const plan = planAnalysis(present);
  const covered = new Set([...plan.values()].flat());
  const unanalyzed = present.filter((path) => !covered.has(path));

  if (plan.size === 0) {
    return { tools: [], skipped: [], findingsByFile: new Map(), unanalyzed };
  }

  const after = await Promise.all(
    [...plan].map(([analyzer, files]) => runAnalyzer(analyzer, cwd, files)),
  );

  // Second pass over the base version, for the analyzers that can read an
  // isolated copy of the files.
  const before = new Map<string, Finding[]>();
  const doublePass = [...plan].filter(([analyzer]) => analyzer.baseline === "double-pass");

  if (doublePass.length > 0) {
    const base = await extractBaseVersion(cwd, baseRef, [
      ...new Set(doublePass.flatMap(([, files]) => files)),
    ]);

    try {
      if (base.files.length > 0) {
        const existing = new Set(base.files);

        const outcomes = await Promise.all(
          doublePass.map(([analyzer, files]) =>
            runAnalyzer(
              analyzer,
              base.dir,
              files.filter((file) => existing.has(file)),
            ),
          ),
        );

        for (const outcome of outcomes) {
          before.set(outcome.analyzer.name, outcome.findings ?? []);
        }
      }
    } finally {
      await base.cleanup();
    }
  }

  // Lines the PR touched, for the analyzers that cannot use the baseline.
  const changedLines = changedLinesByFile(await runGit(["diff", "--unified=0", range], cwd));

  const tools: string[] = [];
  const skipped: SkippedAnalyzer[] = [];
  const findings: Finding[] = [];

  for (const outcome of after) {
    if (outcome.skipped) {
      skipped.push(outcome.skipped);
      continue;
    }

    tools.push(outcome.analyzer.name);

    const produced = outcome.findings ?? [];

    if (outcome.analyzer.baseline === "double-pass") {
      findings.push(...subtractBaseline(produced, before.get(outcome.analyzer.name) ?? []));
      continue;
    }

    for (const finding of produced) {
      const lines = changedLines.get(finding.path);
      const span = Math.max(1, finding.endLine - finding.line + 1);

      if (
        lines !== undefined &&
        [...Array(span).keys()].some((offset) => lines.has(finding.line + offset))
      ) {
        findings.push(finding);
      }
    }
  }

  findings.sort(
    (a, b) =>
      (SEVERITY_ORDER.get(a.severity) ?? 9) - (SEVERITY_ORDER.get(b.severity) ?? 9) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );

  const findingsByFile = new Map<string, Finding[]>();

  for (const finding of findings) {
    const forFile = findingsByFile.get(finding.path) ?? [];
    forFile.push(finding);
    findingsByFile.set(finding.path, forFile);
  }

  return { tools, skipped, findingsByFile, unanalyzed };
}
