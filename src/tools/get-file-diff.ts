import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SEVERITIES, type Finding } from "../analysis/types.js";
import { UserFacingError } from "../errors.js";
import { fileDiff, type FileDiff } from "../file-diff.js";
import { requireAnalysis, requireFiles, requireSession } from "../review/session.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
  path: z.string().describe("Ruta del archivo, de las que devolvió get_pr_files."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Bloque por el que empezar. Para continuar un diff largo, usa el nextOffset de la parte anterior.",
    ),
};

const outputSchema = {
  reviewId: z.string(),
  path: z.string(),
  diff: z.string(),
  offset: z.number(),
  hunksIncluded: z.number(),
  totalHunks: z.number(),
  hasMore: z.boolean(),
  nextOffset: z.number().optional(),
  analyzedBy: z.array(z.string()),
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

function format(
  part: FileDiff,
  findings: Finding[],
  analyzed: boolean,
  analyzedBy: string[],
): string {
  const lines = [part.path];
  const last = part.offset + part.hunksIncluded;

  if (part.hasMore || part.offset > 0) {
    lines.push(
      `Bloques ${part.offset + 1}-${last} de ${part.totalHunks}` +
        (part.hasMore
          ? ` · faltan ${part.totalHunks - last}, pide offset: ${part.nextOffset}`
          : " · último bloque"),
    );
  }

  // The findings come from analyze_pr, not from a new run: same commits, same
  // data every step of the review.
  if (!analyzed) {
    lines.push("Herramientas: ninguna cubre este lenguaje. Solo lo revisa el agente.");
  } else if (findings.length === 0) {
    lines.push(`Herramientas (${analyzedBy.join(", ")}): ningún problema en este archivo.`);
  } else {
    lines.push(`Herramientas (${analyzedBy.join(", ")}): ${findings.length} problema(s)`);

    for (const finding of findings) {
      lines.push(
        `  L${finding.line} · [${finding.severity}] ${finding.tool}/${finding.rule} — ${finding.message}`,
      );
    }
  }

  lines.push("", part.diff);

  return lines.join("\n");
}

export function registerGetFileDiff(server: McpServer): void {
  server.registerTool(
    "get_file_diff",
    {
      title: "Ver el diff de un archivo",
      description:
        "Quinto paso, uno por archivo. Devuelve el diff de un archivo del pull request junto con los problemas que analyze_pr detectó en él, para revisarlo con todo delante. Los diffs largos llegan por partes cortadas entre bloques de cambio. Lo que las herramientas no cubren —diseño, lógica de negocio, si los tests prueban lo que dicen— es lo que tienes que valorar tú a partir del diff. Requiere el reviewId y haber llamado a get_pr_files y analyze_pr.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId, path, offset }) => {
      try {
        const session = requireSession(reviewId);
        const files = requireFiles(session);
        const analysis = requireAnalysis(session);

        const cleanPath = path.trim();
        const known = files.find((file) => file.path === cleanPath);

        if (!known) {
          throw new UserFacingError(
            `"${cleanPath}" no está entre los ${files.length} archivos del PR. Usa una ruta de las que devolvió get_pr_files.`,
          );
        }

        if (known.status === "deleted") {
          throw new UserFacingError(
            `"${cleanPath}" fue eliminado por el PR, así que no hay contenido que revisar.`,
          );
        }

        const part = await fileDiff(session.repoPath, session.range, cleanPath, offset ?? 0);
        const findings = analysis.findingsByFile.get(cleanPath) ?? [];
        const analyzed = !analysis.unanalyzed.includes(cleanPath) && analysis.tools.length > 0;

        return {
          content: [
            { type: "text", text: format(part, findings, analyzed, analysis.tools) },
          ],
          structuredContent: {
            reviewId: session.id,
            path: part.path,
            diff: part.diff,
            offset: part.offset,
            hunksIncluded: part.hunksIncluded,
            totalHunks: part.totalHunks,
            hasMore: part.hasMore,
            nextOffset: part.nextOffset,
            analyzedBy: analyzed ? analysis.tools : [],
            findings,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo obtener el diff.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
