import { parseJson, runTool } from "./run-tool.js";
import { toRelative, type Analyzer, type AnalyzerContext, type Finding } from "./types.js";

/** eslint exits with 1 when it reports errors. */
const EXIT_WITH_ISSUES = 1;

type RawReport = {
  filePath?: string;
  messages?: {
    ruleId?: string | null;
    severity?: number;
    message?: string;
    line?: number;
    endLine?: number;
  }[];
}[];

export const eslint: Analyzer = {
  name: "ESLint",
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"],

  // Needs the node_modules of the repository to load its own config.
  baseline: "changed-lines",

  async run({ cwd, files }: AnalyzerContext): Promise<Finding[]> {
    // Through npx and without --no-install fallbacks: this must be the repo's
    // own ESLint and its own config, not a generic one we impose.
    const stdout = await runTool(
      "npx",
      ["--no-install", "eslint", "--format", "json", ...files],
      {
        cwd,
        analyzer: "ESLint",
        okExitCodes: [EXIT_WITH_ISSUES],
        installHint:
          "Instálalo en el repositorio (`npm install --save-dev eslint`); se usa el ESLint y la configuración del propio proyecto.",
      },
    );

    return parseJson<RawReport>(stdout, "ESLint").flatMap((file) =>
      (file.messages ?? []).map((message) => {
        const line = message.line ?? 0;

        return {
          tool: "ESLint",
          path: toRelative(file.filePath ?? "", cwd),
          line,
          endLine: message.endLine ?? line,
          rule: message.ruleId ?? "error-de-parseo",
          severity: message.severity === 2 ? ("high" as const) : ("medium" as const),
          message: (message.message ?? "").trim(),
        };
      }),
    );
  },
};
