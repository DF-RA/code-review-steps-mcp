import { parseJson, runTool } from "./run-tool.js";
import { parseSarif } from "./sarif.js";
import type { Analyzer, AnalyzerContext, Finding } from "./types.js";

export const SEMGREP_CONFIG_ENV_VAR = "CODE_REVIEW_MCP_SEMGREP_CONFIG";

/**
 * Default ruleset. Point this at a local directory of your own rules to run
 * fully offline and with the conventions of your team.
 */
const DEFAULT_CONFIG = "p/default";

/** semgrep exits with 1 when it reports findings. */
const EXIT_WITH_FINDINGS = 1;

export function semgrepConfig(): string {
  return process.env[SEMGREP_CONFIG_ENV_VAR]?.trim() || DEFAULT_CONFIG;
}

export const semgrep: Analyzer = {
  // Empty: Semgrep runs over every file of the PR, whatever the language.
  extensions: [],
  name: "Semgrep",

  baseline: "double-pass",
  docker: {
    image: process.env.CODE_REVIEW_MCP_SEMGREP_IMAGE?.trim() || "semgrep/semgrep:latest",
    // The image entrypoint is not the tool itself.
    entrypoint: "semgrep",
    // The only analyzer that needs it: rulesets are downloaded.
    network: true,
  },

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    const stdout = await runTool(
      "semgrep",
      [
        "scan",
        "--config",
        semgrepConfig(),
        "--sarif",
        // Nothing about this code leaves the machine.
        "--metrics",
        "off",
        "--quiet",
        ...files,
      ],
      {
        cwd,
        analyzer: "Semgrep",
        docker: semgrep.docker,
        okExitCodes: [EXIT_WITH_FINDINGS],
        installHint: "Instálalo con `brew install semgrep`.",
      },
    );

    if (!stdout.trim()) {
      return [];
    }

    return parseSarif(parseJson<object>(stdout, "Semgrep"), "Semgrep", cwd);
  },
};
