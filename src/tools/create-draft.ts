import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { countByStatus, toDraftComment, type DraftComment } from "../draft/draft.js";
import { draftUrl, ensureServer } from "../draft/server.js";
import { UserFacingError } from "../errors.js";
import { requireFiles, requireSession } from "../review/session.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
};

const outputSchema = {
  reviewId: z.string(),
  url: z.string(),
  comments: z.number(),
  reviewedFiles: z.number(),
  totalFiles: z.number(),
  markdown: z.string(),
};

export function registerCreateDraft(server: McpServer): void {
  server.registerTool(
    "create_draft",
    {
      title: "Crear el borrador de la revisión",
      description:
        "Séptimo paso. Junta los comentarios registrados en un borrador y lo publica en una página local para que la persona lo revise en su navegador: puede editar cada comentario, marcarlo como válido, descartarlo o pedir otra vuelta. Devuelve el enlace. Después de llamarla, DETENTE y pide a la persona que abra el enlace y confirme; consulta get_draft_status cuando te avise.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);
        const files = requireFiles(session);

        if (!session.reviews || session.reviews.size === 0) {
          throw new UserFacingError(
            "Todavía no hay ninguna revisión registrada. Revisa los archivos con el prompt review_file y regístralos con record_file_review antes de crear el borrador.",
          );
        }

        const pending = files.map((file) => file.path).filter((path) => !session.reviews?.has(path));

        // Rebuilt from the recorded reviews, but decisions already made on the
        // page survive: a redraft after a "rework" must not reset the rest.
        const previous = new Map(session.draft?.comments.map((comment) => [comment.id, comment]));
        const comments: DraftComment[] = [];

        for (const [path, forFile] of session.reviews) {
          forFile.forEach((comment, index) => {
            // Hashed, not "path#index": ids travel in a URL path, and both the
            // slash and the hash would break it. Stable across redrafts so the
            // decisions already taken survive.
            const id = createHash("sha1").update(`${path}#${index}`).digest("hex").slice(0, 12);
            const existing = previous.get(id);
            const fresh = toDraftComment(comment, id);

            comments.push(
              existing && existing.title === fresh.title
                ? { ...fresh, status: existing.status, body: existing.body, edited: existing.edited }
                : fresh,
            );
          });
        }

        session.draft = {
          comments,
          confirmed: false,
          createdAt: Date.now(),
        };

        const url = draftUrl(await ensureServer(), session.id);
        const counts = countByStatus(session.draft);

        const markdown = comments
          .map((comment) => `- [${comment.severity}] ${comment.path ?? "PR"}${comment.line ? ` L${comment.line}` : ""} — ${comment.title}`)
          .join("\n");

        const lines = [
          `Borrador de la revisión del PR #${session.prNumber}: ${comments.length} comentario(s).`,
          "",
          markdown || "(sin comentarios)",
          "",
          `Ábrelo aquí: ${url}`,
          "",
          "En esa página puedes editar cada comentario, marcarlo como válido, descartarlo o pedir otra vuelta, y confirmar el borrador cuando termines.",
        ];

        if (pending.length > 0) {
          lines.push(
            "",
            `Aviso: quedan ${pending.length} archivo(s) del PR sin revisar, así que el borrador está incompleto.`,
          );
        }

        if (counts.pending !== comments.length) {
          lines.push("", "Se conservaron las decisiones que ya habías tomado sobre los comentarios anteriores.");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            reviewId: session.id,
            url,
            comments: comments.length,
            reviewedFiles: session.reviews.size,
            totalFiles: files.length,
            markdown,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo crear el borrador.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
