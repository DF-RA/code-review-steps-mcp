import { parseJson, runTool } from "./run-tool.js";
import { toRelative, type Analyzer, type AnalyzerContext, type Finding } from "./types.js";

/** ruff exits with 1 when it reports violations. */
const EXIT_WITH_ISSUES = 1;

type RawReport = {
  filename?: string;
  code?: string;
  message?: string;
  url?: string;
  location?: { row?: number };
  end_location?: { row?: number };
}[];

export const ruff: Analyzer = {
  name: "Ruff",
  extensions: [".py", ".pyi"],

  baseline: "double-pass",
  docker: { image: process.env.CODE_REVIEW_MCP_RUFF_IMAGE?.trim() || "ghcr.io/astral-sh/ruff:latest" },

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    const stdout = await runTool("ruff", [
      "check",
      "--output-format",
      "json",
      // The repository is mounted read-only in Docker, and a cache would also
      // make the two passes of the baseline influence each other.
      "--no-cache",
      ...files,
    ], {
      cwd,
      analyzer: "Ruff",
      docker: ruff.docker,
      okExitCodes: [EXIT_WITH_ISSUES],
      installHint: "Instálalo con `brew install ruff`.",
    });

    return parseJson<RawReport>(stdout, "Ruff").map((issue) => {
      const line = issue.location?.row ?? 0;

      return {
        tool: "Ruff",
        path: toRelative(issue.filename ?? "", cwd),
        line,
        endLine: issue.end_location?.row ?? line,
        rule: issue.code ?? "desconocida",
        // Ruff does not grade severity: everything it reports is a rule violation.
        severity: "medium" as const,
        message: (issue.message ?? "").trim(),
        url: issue.url,
      };
    });
  },
};
