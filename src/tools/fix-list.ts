import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { draftUrl, ensureServer } from "../draft/server.js";
import { UserFacingError } from "../errors.js";
import { FIX_STATUSES, countFixes, type FixItem } from "../review/fixes.js";
import { requireSession, type ReviewSession } from "../review/session.js";

function requireFixes(session: ReviewSession): FixItem[] {
  if (!session.fixes) {
    throw new UserFacingError(
      "Todavía no hay lista de trabajo. Créala con create_fix_list y este reviewId.",
    );
  }

  return session.fixes;
}

function describe(fix: FixItem): string {
  const where = fix.path
    ? `${fix.path}${fix.line ? ` L${fix.line}` : ""}`
    : "todo el PR";

  return `[${fix.severity}] ${where} — ${fix.title}`;
}

export function registerFixList(server: McpServer): void {
  server.registerTool(
    "create_fix_list",
    {
      title: "Convertir los comentarios en lista de trabajo",
      description:
        "Convierte los comentarios que la persona dio por válidos en una lista de cosas que arreglar, para recorrerlas una a una. Es la alternativa a publicar: sirve cuando el pull request es tuyo y no quieres dejar comentarios, sino resolverlos. La lista se ve y se marca en la misma página del borrador.",
      inputSchema: { reviewId: z.string().describe("El reviewId que devolvió start_review.") },
      outputSchema: {
        reviewId: z.string(),
        url: z.string(),
        total: z.number(),
        fixes: z.array(
          z.object({
            id: z.string(),
            path: z.string().optional(),
            line: z.number().optional(),
            severity: z.string(),
            title: z.string(),
            status: z.enum(FIX_STATUSES),
          }),
        ),
      },
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);
        const approved = (session.draft?.comments ?? []).filter(
          (comment) => comment.status === "valid",
        );

        if (approved.length === 0) {
          throw new UserFacingError(
            "No hay comentarios marcados como válidos, así que no hay nada que resolver.",
          );
        }

        // Rebuilding keeps what was already done: the ids come from the draft.
        const previous = new Map(session.fixes?.map((fix) => [fix.id, fix]));

        session.fixes = approved.map((comment) => {
          const existing = previous.get(comment.id);

          return {
            id: comment.id,
            path: comment.path,
            line: comment.line,
            endLine: comment.endLine,
            severity: comment.severity,
            title: comment.title,
            body: comment.body,
            status: existing?.status ?? "pending",
            note: existing?.note,
          };
        });

        const url = draftUrl(await ensureServer(), session.id);

        return {
          content: [
            {
              type: "text",
              text: [
                `Lista de trabajo del PR #${session.prNumber}: ${session.fixes.length} punto(s).`,
                "",
                ...session.fixes.map((fix, index) => `${index + 1}. ${describe(fix)}`),
                "",
                `Puedes seguir el avance aquí: ${url}`,
                "Pide el siguiente con next_fix y ciérralo con complete_fix.",
              ].join("\n"),
            },
          ],
          structuredContent: {
            reviewId: session.id,
            url,
            total: session.fixes.length,
            fixes: session.fixes.map(({ id, path, line, severity, title, status }) => ({
              id,
              path,
              line,
              severity,
              title,
              status,
            })),
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo crear la lista.\n${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "next_fix",
    {
      title: "Siguiente punto por resolver",
      description:
        "Devuelve el siguiente punto pendiente de la lista de trabajo, con su archivo, su línea y el comentario completo. Resuélvelo en el código y ciérralo con complete_fix antes de pedir el siguiente.",
      inputSchema: { reviewId: z.string().describe("El reviewId que devolvió start_review.") },
      outputSchema: {
        reviewId: z.string(),
        remaining: z.number(),
        fix: z
          .object({
            id: z.string(),
            path: z.string().optional(),
            line: z.number().optional(),
            endLine: z.number().optional(),
            severity: z.string(),
            title: z.string(),
            body: z.string(),
          })
          .optional(),
      },
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);
        const fixes = requireFixes(session);
        const counts = countFixes(fixes);
        const next = fixes.find((fix) => fix.status === "pending");

        if (!next) {
          return {
            content: [
              {
                type: "text",
                text: `No queda nada pendiente: ${counts.done} resuelto(s) y ${counts.skipped} omitido(s) de ${fixes.length}.`,
              },
            ],
            structuredContent: { reviewId: session.id, remaining: 0 },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Pendiente ${fixes.length - counts.pending + 1} de ${fixes.length}:`,
                "",
                describe(next),
                "",
                next.body,
                "",
                "Cuando lo resuelvas, ciérralo con complete_fix indicando qué hiciste.",
              ].join("\n"),
            },
          ],
          structuredContent: {
            reviewId: session.id,
            remaining: counts.pending,
            fix: {
              id: next.id,
              path: next.path,
              line: next.line,
              endLine: next.endLine,
              severity: next.severity,
              title: next.title,
              body: next.body,
            },
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo obtener el siguiente punto.\n${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "complete_fix",
    {
      title: "Cerrar un punto de la lista",
      description:
        "Marca un punto de la lista de trabajo como resuelto u omitido, con una nota de qué se hizo. La nota importa: es lo que queda como registro de por qué el código quedó así.",
      inputSchema: {
        reviewId: z.string().describe("El reviewId que devolvió start_review."),
        id: z.string().describe("Id del punto, tal como lo devuelve next_fix."),
        status: z
          .enum(["done", "skipped"])
          .describe("done si lo arreglaste, skipped si decidiste no hacerlo."),
        note: z
          .string()
          .describe("Qué hiciste, o por qué se omite. Una o dos frases."),
      },
      outputSchema: {
        reviewId: z.string(),
        done: z.number(),
        skipped: z.number(),
        pending: z.number(),
      },
    },
    async ({ reviewId, id, status, note }) => {
      try {
        const session = requireSession(reviewId);
        const fixes = requireFixes(session);
        const fix = fixes.find((candidate) => candidate.id === id);

        if (!fix) {
          throw new UserFacingError(`No hay ningún punto con id "${id}" en la lista.`);
        }

        fix.status = status;
        fix.note = note.trim() || undefined;

        const counts = countFixes(fixes);

        return {
          content: [
            {
              type: "text",
              text: [
                `${status === "done" ? "Resuelto" : "Omitido"}: ${fix.title}`,
                `Avance: ${counts.done} resuelto(s), ${counts.skipped} omitido(s), ${counts.pending} pendiente(s).`,
                counts.pending > 0 ? "Pide el siguiente con next_fix." : "La lista está completa.",
              ].join("\n"),
            },
          ],
          structuredContent: {
            reviewId: session.id,
            done: counts.done,
            skipped: counts.skipped,
            pending: counts.pending,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo cerrar el punto.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
