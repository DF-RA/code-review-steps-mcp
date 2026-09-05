import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UserFacingError } from "../errors.js";
import { requireSession } from "../review/session.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
  found: z
    .boolean()
    .describe(
      "true si encontraste la tarea. false si el PR no referencia ninguna, si el gestor de tareas no está disponible o si no la encontró: en ese caso indica reason.",
    ),
  reason: z
    .string()
    .optional()
    .describe("Por qué no hay contexto. Obligatorio cuando found es false."),
  code: z.string().optional().describe("Código de la tarea, por ejemplo PROJ-1234."),
  title: z.string().optional().describe("Título de la tarea."),
  summary: z
    .string()
    .optional()
    .describe(
      "Qué pide la tarea, en dos o tres frases tuyas. Es lo que leerán los pasos siguientes, así que tiene que entenderse sin abrir la tarea.",
    ),
  url: z.string().optional().describe("Enlace a la tarea."),
  assignee: z.string().optional().describe("A quién está asignada."),
  assignedToAuthor: z
    .boolean()
    .optional()
    .describe(
      "Si la tarea está asignada al autor del PR. Déjalo sin indicar si no puedes afirmarlo con seguridad. Es información interna: no aparece en los comentarios que se publican.",
    ),
};

const outputSchema = {
  reviewId: z.string(),
  found: z.boolean(),
  code: z.string().optional(),
  assignedToAuthor: z.boolean().optional(),
};

export function registerRecordTaskContext(server: McpServer): void {
  server.registerTool(
    "record_task_context",
    {
      title: "Registrar el contexto de la tarea",
      description:
        "Guarda en la revisión lo que se encontró sobre la tarea del pull request. Llámala siempre después del prompt task_context, también cuando no haya tarea o el gestor no esté disponible: registrando found: false el flujo continúa sin ese contexto. Los pasos siguientes leen esto en vez de volver a consultarlo.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId, found, reason, code, title, summary, url, assignee, assignedToAuthor }) => {
      try {
        const session = requireSession(reviewId);

        if (!found && !reason?.trim()) {
          throw new UserFacingError(
            "Si no hay contexto de tarea, indica en reason por qué: sin tarea referenciada, gestor no disponible, o código no encontrado.",
          );
        }

        session.taskContext = {
          found,
          reason: reason?.trim() || undefined,
          code: code?.trim() || undefined,
          title: title?.trim() || undefined,
          summary: summary?.trim() || undefined,
          url: url?.trim() || undefined,
          assignee: assignee?.trim() || undefined,
          assignedToAuthor,
        };

        const lines = found
          ? [
              `Contexto de la tarea registrado: ${code ?? "sin código"}${title ? ` — ${title}` : ""}.`,
              assignedToAuthor === false
                ? `Aviso interno: la tarea está asignada a ${assignee ?? "otra persona"}, no al autor del PR (${session.author}). Queda aquí para que lo sepas; no se incluye en los comentarios que se publican.`
                : "",
            ]
          : [`Sin contexto de tarea: ${reason}.`, "La revisión sigue sin él."];

        lines.push("", "Siguiente: get_pr_files con este reviewId.");

        return {
          content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
          structuredContent: {
            reviewId: session.id,
            found,
            code: session.taskContext.code,
            assignedToAuthor,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudo registrar el contexto.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
