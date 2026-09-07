import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserFacingError } from "../errors.js";
import {
  COMMENT_SCOPES,
  COMMENT_SEVERITIES,
  renderComment,
  type ReviewComment,
} from "../review/comments.js";
import { saveFileReview } from "../review/db.js";
import { requireFiles, requireSession } from "../review/session.js";

const commentSchema = z.object({
  scope: z
    .enum(COMMENT_SCOPES)
    .describe(
      "line: anclado a una línea concreta, que es lo normal. file: afecta al archivo entero y no se puede señalar una línea. pr: no pertenece a ningún archivo (por ejemplo, el pipeline).",
    ),
  line: z.number().int().positive().optional().describe("Línea del archivo. Obligatoria con scope line."),
  endLine: z.number().int().positive().optional().describe("Última línea, si el punto abarca un rango."),
  severity: z
    .enum(COMMENT_SEVERITIES)
    .describe(
      "blocker: no debería mergearse así. issue: hay que arreglarlo. suggestion: mejora opcional. question: falta información para juzgarlo.",
    ),
  title: z.string().describe("Una línea: qué pasa."),
  body: z.string().describe("Por qué importa y qué hacer al respecto."),
  raisedBy: z
    .string()
    .optional()
    .describe("Rol que lo levantó: programador, qa, arquitecto, product o lider."),
});

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
  pathId: z
    .string()
    .describe("Identificador del archivo revisado (pathId), de los que devolvió get_pr_files."),
  comments: z
    .array(commentSchema)
    .describe(
      "Conclusión del líder de proyecto, un comentario por punto. Lista vacía si no hay nada que señalar.",
    ),
};

const outputSchema = {
  reviewId: z.string(),
  path: z.string(),
  pathId: z.string(),
  recorded: z.number(),
  reviewedFiles: z.number(),
  totalFiles: z.number(),
  pending: z.array(z.string()),
  rendered: z.array(z.string()),
};

export function registerRecordFileReview(server: McpServer): void {
  server.registerTool(
    "record_file_review",
    {
      title: "[Step 6.2] Registrar la revisión de un archivo",
      description:
        "Guarda en la revisión los comentarios que el agente concluyó sobre un archivo, ya con el formato con el que se publicarían. El archivo se indica con su pathId, el mismo que devolvió get_pr_files. Llámala siempre después de revisar un archivo con el prompt review_file, incluso si no hay nada que señalar: así queda constancia de qué se revisó y qué falta. No publica nada en GitHub.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId, pathId, comments }) => {
      try {
        const session = requireSession(reviewId);
        const files = requireFiles(session);
        const wanted = pathId.trim();
        const file = files.find((candidate) => candidate.pathId === wanted);

        if (!file) {
          // Passing the path is the easy slip, so answer with the id it wanted.
          const byPath = files.find((candidate) => candidate.path === wanted);

          throw new UserFacingError(
            byPath
              ? `"${wanted}" es la ruta, no el pathId. El de ese archivo es ${byPath.pathId}.`
              : `No hay ningún archivo con pathId "${wanted}" entre los ${files.length} del PR. Usa uno de los que devolvió get_pr_files.`,
          );
        }

        const cleanPath = file.path;

        const stored: ReviewComment[] = comments.map((comment) => ({
          ...comment,
          // Line-scoped comments belong to this file; pr-scoped ones to nothing.
          path: comment.scope === "pr" ? undefined : cleanPath,
        }));

        for (const comment of stored) {
          if (comment.scope === "line" && comment.line === undefined) {
            throw new UserFacingError(
              `El comentario "${comment.title}" usa scope "line" pero no indica la línea. Indícala, o usa scope "file".`,
            );
          }
        }

        session.reviews ??= new Map();
        session.reviews.set(cleanPath, stored);
        saveFileReview(session.id, file.pathId, stored);

        const pending = files
          .map((file) => file.path)
          .filter((filePath) => !session.reviews?.has(filePath));

        const rendered = stored.map(renderComment);
        const lines = [
          `Registrada la revisión de ${cleanPath}: ${stored.length} comentario(s).`,
          `Archivos revisados: ${session.reviews.size} de ${files.length}.`,
        ];

        if (pending.length > 0) {
          lines.push("", `Faltan ${pending.length}:`);
          lines.push(...pending.slice(0, 15).map((filePath) => `  · ${filePath}`));

          if (pending.length > 15) {
            lines.push(`  … y ${pending.length - 15} más`);
          }
        } else {
          lines.push("", "Todos los archivos del PR están revisados.");
        }

        if (rendered.length > 0) {
          lines.push("", "Comentarios tal como se publicarían:", "", rendered.join("\n\n"));
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            reviewId: session.id,
            path: cleanPath,
            pathId: file.pathId,
            recorded: stored.length,
            reviewedFiles: session.reviews.size,
            totalFiles: files.length,
            pending,
            rendered,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo registrar la revisión.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
