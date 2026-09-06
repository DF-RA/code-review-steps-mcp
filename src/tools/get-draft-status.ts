import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { DRAFT_STATUSES, countByStatus, renderDraftComment } from "../draft/draft.js";
import { draftUrl, ensureServer } from "../draft/server.js";
import { UserFacingError } from "../errors.js";
import { requireSession } from "../review/session.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
};

const outputSchema = {
  reviewId: z.string(),
  url: z.string(),
  confirmed: z.boolean(),
  counts: z.object({
    pending: z.number(),
    valid: z.number(),
    discarded: z.number(),
    rework: z.number(),
  }),
  rework: z.array(
    z.object({
      id: z.string(),
      path: z.string().optional(),
      line: z.number().optional(),
      title: z.string(),
      note: z.string().optional(),
    }),
  ),
  approved: z.array(z.string()),
};

export function registerGetDraftStatus(server: McpServer): void {
  server.registerTool(
    "get_draft_status",
    {
      title: "Consultar el estado del borrador",
      description:
        "Octavo paso. Devuelve qué decidió la persona sobre cada comentario del borrador: cuáles dio por válidos, cuáles descartó y cuáles quiere que rehagas, con la nota de qué cambiar. Consúltala cuando la persona te avise de que ya revisó la página. Si hay comentarios marcados para otra vuelta, rehazlos, regístralos de nuevo con record_file_review y vuelve a crear el borrador.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);

        if (!session.draft) {
          throw new UserFacingError(
            "Todavía no hay borrador. Créalo con create_draft y pide a la persona que lo revise.",
          );
        }

        const draft = session.draft;
        const counts = countByStatus(draft);
        const url = draftUrl(await ensureServer(), session.id);

        const rework = draft.comments
          .filter((comment) => comment.status === "rework")
          .map((comment) => ({
            id: comment.id,
            path: comment.path,
            line: comment.line,
            title: comment.title,
            note: comment.note,
          }));

        const approved = draft.comments
          .filter((comment) => comment.status === "valid")
          .map(renderDraftComment);

        const lines = [
          draft.confirmed
            ? `Borrador CONFIRMADO por la persona.`
            : `Borrador todavía SIN confirmar. Espera a que termine de revisarlo: ${url}`,
          `${counts.valid} válido(s) · ${counts.discarded} descartado(s) · ${counts.rework} para otra vuelta · ${counts.pending} sin revisar`,
        ];

        if (rework.length > 0) {
          lines.push("", "Comentarios que la persona quiere que rehagas:");

          for (const comment of rework) {
            lines.push(
              `  · ${comment.path ?? "PR"}${comment.line ? ` L${comment.line}` : ""} — ${comment.title}`,
            );
            lines.push(`      ${comment.note ?? "(sin indicaciones; pregúntale qué cambiar)"}`);
          }

          lines.push(
            "",
            "Rehazlos, regístralos con record_file_review y vuelve a llamar a create_draft: se conservan las decisiones ya tomadas sobre los demás.",
          );
        }

        if (draft.confirmed && rework.length === 0) {
          lines.push(
            "",
            approved.length > 0
              ? `${approved.length} comentario(s) listos para publicar.`
              : "No quedó ningún comentario aprobado: la persona descartó todos.",
          );
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            reviewId: session.id,
            url,
            confirmed: draft.confirmed,
            counts,
            rework,
            approved,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo consultar el borrador.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
