import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseSarif } from "./sarif.js";
import { runTool } from "./run-tool.js";
import type { Analyzer, AnalyzerContext, Finding } from "./types.js";

export const DETEKT_PATH_ENV_VAR = "CODE_REVIEW_MCP_DETEKT_PATH";

/** detekt exits with 2 when it found issues. */
const EXIT_WITH_ISSUES = 2;

export const detekt: Analyzer = {
  name: "detekt",
  extensions: [".kt", ".kts"],

  baseline: "double-pass",
  // No official image published, so this one has to be installed locally.

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    // detekt only writes its report to a file, so it goes to a temp dir.
    const dir = await mkdtemp(join(tmpdir(), "code-review-mcp-"));
    const reportPath = join(dir, "detekt.sarif");

    try {
      await runTool(
        process.env[DETEKT_PATH_ENV_VAR]?.trim() || "detekt",
        ["--input", files.join(","), "--report", `sarif:${reportPath}`],
        {
          cwd,
          analyzer: "detekt",
          okExitCodes: [EXIT_WITH_ISSUES],
          installHint: `Instálalo con \`brew install detekt\`, o indica la ruta en ${DETEKT_PATH_ENV_VAR}.`,
        },
      );

      const report = await readFile(reportPath, "utf8").catch(() => "");

      if (!report.trim()) {
        return [];
      }

      return parseSarif(JSON.parse(report) as object, "detekt", cwd);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
