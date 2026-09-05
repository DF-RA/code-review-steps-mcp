import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseJson, runTool } from "./run-tool.js";
import {
  severityFromPriority,
  toRelative,
  type Analyzer,
  type AnalyzerContext,
  type Finding,
} from "./types.js";

export const PMD_PATH_ENV_VAR = "CODE_REVIEW_MCP_PMD_PATH";
export const PMD_RULESET_ENV_VAR = "CODE_REVIEW_MCP_PMD_RULESET";

/** Root of this package, from dist/analysis/ back up two levels. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** PMD quickstart with the test naming rules tuned. See rulesets/java.xml. */
const DEFAULT_RULESET = join(PACKAGE_ROOT, "rulesets", "java.xml");

/** Where a file-based ruleset gets mounted inside the container. */
const CONTAINER_RULESET_DIR = "/rulesets";

/** PMD exits with 4 when it found violations. That is a result, not a failure. */
const EXIT_WITH_VIOLATIONS = 4;

interface RawReport {
  files?: {
    filename?: string;
    violations?: {
      beginline?: number;
      endline?: number;
      rule?: string;
      priority?: number;
      description?: string;
      externalInfoUrl?: string;
    }[];
  }[];
}

export function pmdRuleset(): string {
  return process.env[PMD_RULESET_ENV_VAR]?.trim() || DEFAULT_RULESET;
}

/** A ruleset can be a file on disk or a name PMD resolves from its classpath. */
function isRulesetFile(ruleset: string): boolean {
  return isAbsolute(ruleset) || ruleset.startsWith(".");
}

export const pmd: Analyzer = {
  name: "PMD",
  extensions: [".java"],
  baseline: "double-pass",
  docker: { image: process.env.CODE_REVIEW_MCP_PMD_IMAGE?.trim() || "pmdcode/pmd:latest" },

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    const ruleset = pmdRuleset();
    const args = (rulesetPath: string): string[] => [
      "check",
      // Relative paths on purpose: the same command has to work inside the
      // container, where the clone is mounted at a different root.
      "--dir",
      files.join(","),
      "--rulesets",
      rulesetPath,
      "--format",
      "json",
      "--no-cache",
    ];

    // A ruleset file lives outside the repository, so the container needs it
    // mounted and referenced by its path in there.
    const docker = isRulesetFile(ruleset)
      ? {
          ...pmd.docker,
          image: pmd.docker?.image ?? "",
          mounts: [{ host: dirname(ruleset), container: CONTAINER_RULESET_DIR }],
          args: args(join(CONTAINER_RULESET_DIR, ruleset.split("/").pop() ?? "")),
        }
      : pmd.docker;

    const stdout = await runTool(
      process.env[PMD_PATH_ENV_VAR]?.trim() || "pmd",
      args(ruleset),
      {
        cwd,
        analyzer: "PMD",
        okExitCodes: [EXIT_WITH_VIOLATIONS],
        docker,
        installHint: `Instálalo con \`brew install pmd\`, o indica la ruta en ${PMD_PATH_ENV_VAR}.`,
      },
    );

    const report = parseJson<RawReport>(stdout, "PMD");

    return (report.files ?? []).flatMap((file) =>
      (file.violations ?? []).map((violation) => ({
        tool: "PMD",
        path: toRelative(file.filename ?? "", cwd),
        line: violation.beginline ?? 0,
        endLine: violation.endline ?? violation.beginline ?? 0,
        rule: violation.rule ?? "desconocida",
        severity: severityFromPriority(violation.priority ?? 3),
        message: (violation.description ?? "").trim(),
        url: violation.externalInfoUrl || undefined,
      })),
    );
  },
};
