import { parseJson, runTool } from "./run-tool.js";
import { toRelative, type Analyzer, type AnalyzerContext, type Finding, type Severity } from "./types.js";

/** golangci-lint exits with 1 when it reports issues. */
const EXIT_WITH_ISSUES = 1;

interface RawReport {
  Issues?: {
    FromLinter?: string;
    Text?: string;
    Severity?: string;
    Pos?: { Filename?: string; Line?: number };
  }[];
}

function severityOf(value?: string): Severity {
  const normalized = (value ?? "").toLowerCase();

  if (normalized === "error") {
    return "high";
  }
  return normalized === "warning" ? "medium" : "low";
}

export const golangci: Analyzer = {
  name: "golangci-lint",
  extensions: [".go"],

  // Needs the module context and its dependencies: cannot run over an
  // isolated copy of the changed files, so it falls back to line filtering.
  baseline: "changed-lines",

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    // Runs over the whole module and gets filtered afterwards: golangci-lint
    // needs the package context to type-check, so file-by-file gives false
    // positives about undefined symbols.
    const stdout = await runTool(
      "golangci-lint",
      ["run", "--output.json.path", "stdout", "--issues-exit-code", "1", "./..."],
      {
        cwd,
        analyzer: "golangci-lint",
        okExitCodes: [EXIT_WITH_ISSUES],
        installHint: "Instálalo con `brew install golangci-lint`.",
      },
    );

    const report = parseJson<RawReport>(stdout, "golangci-lint");
    const wanted = new Set(files);

    return (report.Issues ?? [])
      .map((issue): Finding => {
        const line = issue.Pos?.Line ?? 0;

        return {
          tool: "golangci-lint",
          path: toRelative(issue.Pos?.Filename ?? "", cwd),
          line,
          endLine: line,
          rule: issue.FromLinter ?? "desconocida",
          severity: severityOf(issue.Severity),
          message: (issue.Text ?? "").trim(),
        };
      })
      .filter((finding) => wanted.has(finding.path));
  },
};
