import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SEVERITIES } from "../analysis/types.js";
import { UserFacingError } from "../errors.js";
import { requireFiles, requireSession } from "../review/session.js";
import { analyzePullRequest } from "../static-analysis.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
};

const outputSchema = {
  reviewId: z.string(),
  prNumber: z.number(),
  tools: z.array(z.string()),
  skipped: z.array(z.object({ tool: z.string(), reason: z.string() })),
  unanalyzed: z.array(z.string()),
  findings: z.array(
    z.object({
      tool: z.string(),
      path: z.string(),
      line: z.number(),
      endLine: z.number(),
      rule: z.string(),
      severity: z.enum(SEVERITIES),
      message: z.string(),
      url: z.string().optional(),
    }),
  ),
};

export function registerAnalyzePr(server: McpServer): void {
  server.registerTool(
    "analyze_pr",
    {
      title: "Analizar el PR con herramientas",
      description:
        "Cuarto paso. Pasa los analizadores estáticos (PMD, detekt, golangci-lint, ESLint, Ruff y Semgrep) sobre los archivos del pull request y guarda en la revisión los problemas que el PR introdujo, comparando cada archivo contra su versión anterior. Se ejecuta una sola vez para todo el PR porque estas herramientas necesitan leer archivos completos: no saben interpretar un diff. get_file_diff entrega después, archivo por archivo, el diff junto con los problemas que aquí se detectaron. Requiere el reviewId de start_review y haber llamado a get_pr_files.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);
        const files = requireFiles(session);

        const analysis = await analyzePullRequest(
          session.repoPath,
          session.baseSha,
          session.range,
          files.filter((file) => file.status !== "deleted").map((file) => file.path),
        );

        session.analysis = analysis;

        const findings = [...analysis.findingsByFile.values()].flat();
        const lines = [
          `PR #${session.prNumber} — análisis con herramientas`,
          `Ejecutadas: ${analysis.tools.join(", ") || "ninguna"}`,
        ];

        // Missing tools are reported, never silently ignored: otherwise a clean
        // result would be indistinguishable from one nobody checked.
        for (const skipped of analysis.skipped) {
          lines.push(`  ! ${skipped.tool} no se ejecutó — ${skipped.reason}`);
        }

        if (analysis.unanalyzed.length > 0) {
          lines.push(
            `${analysis.unanalyzed.length} archivo(s) sin analizador para su lenguaje: los revisa solo el agente.`,
          );
        }

        lines.push("", `${findings.length} problema(s) introducidos por el PR:`);

        if (findings.length === 0) {
          lines.push("  (ninguno)");
        }

        for (const [path, forFile] of analysis.findingsByFile) {
          lines.push("", path);

          for (const finding of forFile) {
            lines.push(
              `  L${finding.line} · [${finding.severity}] ${finding.tool}/${finding.rule} — ${finding.message}`,
            );
          }
        }

        lines.push(
          "",
          "Siguiente: get_file_diff por cada archivo, que trae el diff con estos problemas ya asociados.",
        );

        const nothingRan = analysis.tools.length === 0 && analysis.unanalyzed.length === 0;

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            reviewId: session.id,
            prNumber: session.prNumber,
            tools: analysis.tools,
            skipped: analysis.skipped,
            unanalyzed: analysis.unanalyzed,
            findings,
          },
          ...(nothingRan ? { isError: true } : {}),
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo analizar el PR.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
