import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { countByStatus } from "../draft/draft.js";
import { draftUrl, ensureServer } from "../draft/server.js";
import { UserFacingError } from "../errors.js";
import { refExists } from "../git/git.js";
import { countFixes } from "../review/fixes.js";
import { defaultPath, readExport, writeExport } from "../review/persistence.js";
import { adoptSession, requireSession, type ReviewSession } from "../review/session.js";

/** Where the review got to, so continuing it does not mean guessing. */
function progress(session: ReviewSession): string[] {
  const lines: string[] = [];

  lines.push(`PR #${session.prNumber} — ${session.title}`);
  lines.push(`Rama: ${session.sourceBranch} → ${session.targetBranch}`);
  lines.push(
    session.taskContext
      ? session.taskContext.found
        ? `Tarea: ${session.taskContext.code ?? "encontrada"}`
        : `Tarea: sin contexto (${session.taskContext.reason})`
      : "Tarea: paso 2 sin hacer",
  );

  if (!session.files) {
    lines.push("Archivos: paso 3 sin hacer");
    return lines;
  }

  lines.push(`Archivos: ${session.files.length}`);
  lines.push(
    session.analysis
      ? `Análisis: ${session.analysis.tools.join(", ") || "ninguna herramienta"}`
      : "Análisis: paso 4 sin hacer",
  );

  const reviewed = session.reviews?.size ?? 0;
  lines.push(`Revisados: ${reviewed} de ${session.files.length}`);

  if (session.draft) {
    const counts = countByStatus(session.draft);
    lines.push(
      `Borrador: ${session.draft.comments.length} comentario(s) · ${counts.valid} válidos, ${counts.discarded} descartados, ${counts.rework} para otra vuelta, ${counts.pending} sin revisar` +
        (session.draft.confirmed ? " · CONFIRMADO" : ""),
    );
  }

  if (session.fixes) {
    const counts = countFixes(session.fixes);
    lines.push(
      `Lista de trabajo: ${counts.done} resueltos, ${counts.skipped} omitidos, ${counts.pending} pendientes`,
    );
  }

  return lines;
}

export function registerExportImport(server: McpServer): void {
  server.registerTool(
    "export_review",
    {
      title: "Exportar la revisión a un archivo",
      description:
        "Guarda la revisión completa en un archivo JSON: el pull request, los commits, la tarea, los archivos, el análisis, los comentarios y las decisiones tomadas sobre ellos. Sirve para retomarla más tarde con import_review, incluso después de reiniciar. Las revisiones viven en memoria y caducan a las 4 horas, así que esto es lo único que las conserva.",
      inputSchema: {
        reviewId: z.string().describe("El reviewId que devolvió start_review."),
        file: z
          .string()
          .optional()
          .describe(
            "Ruta del archivo. Si se omite, se guarda en ~/.code-review-steps/<repo>-pr<número>.json.",
          ),
      },
      outputSchema: { reviewId: z.string(), file: z.string(), progress: z.array(z.string()) },
    },
    async ({ reviewId, file }) => {
      try {
        const session = requireSession(reviewId);
        const target = await writeExport(session, file);
        const state = progress(session);

        return {
          content: [
            {
              type: "text",
              text: [
                `Revisión exportada a ${target}`,
                "",
                ...state,
                "",
                `Para continuarla: import_review con esa ruta.`,
              ].join("\n"),
            },
          ],
          structuredContent: { reviewId: session.id, file: target, progress: state },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo exportar la revisión.\n${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "import_review",
    {
      title: "Retomar una revisión exportada",
      description:
        "Carga una revisión guardada con export_review y la deja lista para continuar desde donde se quedó, con el mismo reviewId. Comprueba que el clon y los commits sigan estando: si el pull request recibió cambios después de exportar, avisa de que lo revisado corresponde a otros commits.",
      inputSchema: {
        file: z
          .string()
          .describe("Ruta del archivo exportado, o el nombre dentro de ~/.code-review-steps/."),
      },
      outputSchema: {
        reviewId: z.string(),
        stale: z.boolean(),
        url: z.string().optional(),
        progress: z.array(z.string()),
      },
    },
    async ({ file }) => {
      try {
        const session = await readExport(file);

        // The clone may be gone, or the commits may no longer be there: better
        // to say so now than to fail three steps later.
        const warnings: string[] = [];
        const hasHead = await refExists(session.headSha, session.repoPath).catch(() => false);

        if (!hasHead) {
          warnings.push(
            `El commit ${session.headSha.slice(0, 8)} ya no está en ${session.repoPath}. Puede que el clon haya cambiado o que la rama se borrara: haz \`git fetch\` antes de seguir.`,
          );
        }

        adoptSession(session);

        const state = progress(session);
        const url = session.draft ? draftUrl(await ensureServer(), session.id) : undefined;

        return {
          content: [
            {
              type: "text",
              text: [
                `Revisión retomada. reviewId: ${session.id}`,
                "",
                ...state,
                ...(url ? ["", `Borrador: ${url}`] : []),
                ...(warnings.length > 0 ? ["", ...warnings] : []),
              ].join("\n"),
            },
          ],
          structuredContent: {
            reviewId: session.id,
            stale: !hasHead,
            url,
            progress: state,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo retomar la revisión.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
