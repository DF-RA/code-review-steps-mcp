/** Severity normalized across tools that all grade differently. */
export const SEVERITIES = ["high", "medium", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];

/* Type alias, not interface: findings travel in structuredContent. */
export type Finding = {
  /** Which tool reported it, so two tools agreeing is visible. */
  tool: string;
  /** Repository-relative path. */
  path: string;
  line: number;
  endLine: number;
  rule: string;
  severity: Severity;
  message: string;
  url?: string;
};

/** A tool that is not installed is not an error: the rest still runs. */
export class AnalyzerUnavailableError extends Error {
  constructor(
    readonly analyzer: string,
    readonly hint: string,
  ) {
    super(`${analyzer} no está disponible. ${hint}`);
    this.name = "AnalyzerUnavailableError";
  }
}

export interface AnalyzerContext {
  /** Directory the analyzer runs in: the clone, or a temp copy of the base version. */
  cwd: string;
  /** Repository-relative paths this analyzer should look at. */
  files: string[];
}

/**
 * How to tell apart what the pull request introduced.
 *
 * "double-pass" analyzes the base version too and keeps only what is new. It is
 * the accurate one, and works for analyzers that read plain source files.
 *
 * "changed-lines" keeps findings sitting on lines the PR touched. It is the
 * fallback for analyzers that need the whole project around them (dependencies,
 * node_modules, a compiler) and so cannot run over an isolated copy.
 */
export type BaselineStrategy = "double-pass" | "changed-lines";

export interface DockerMount {
  host: string;
  container: string;
}

/** Fallback for when the binary is not installed on the machine. */
export interface DockerImage {
  /** Files the tool needs that do not live inside the repository. */
  mounts?: DockerMount[];
  /** Replaces the arguments when running in the container, where paths differ. */
  args?: string[];
  /** Pinned on purpose: a moving tag would break reproducibility. */
  image: string;
  /** Overrides the image entrypoint when it does not point at the tool. */
  entrypoint?: string;
  /** Most analyzers need no network at all. */
  network?: boolean;
}

export interface Analyzer {
  /** Shown in every finding it produces. */
  name: string;
  /** Extensions it handles. Empty means "everything it is given". */
  extensions: string[];
  baseline: BaselineStrategy;
  docker?: DockerImage;
  run(context: AnalyzerContext): Promise<Finding[]>;
}

/**
 * Identity of a finding across two versions of a file.
 * Deliberately ignores the line: the same problem moves when code is added
 * above it, and it is still the same problem.
 */
export function fingerprint(finding: Finding): string {
  return [finding.tool, finding.path, finding.rule, finding.message].join("|");
}

/** PMD-style 1..5 priorities, and anything similar. */
export function severityFromPriority(priority: number): Severity {
  if (priority <= 2) {
    return "high";
  }
  return priority === 3 ? "medium" : "low";
}

export function toRelative(path: string, cwd: string): string {
  // "/src" is where docker.ts mounts the repository: a dockerized analyzer
  // reports paths rooted there instead of at the clone.
  for (const root of [cwd, "/src"]) {
    const prefix = root.endsWith("/") ? root : `${root}/`;

    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }

  return path;
}
