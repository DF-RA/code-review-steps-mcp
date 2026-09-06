import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { taskTracker, type TaskTracker } from "../extensions/extension.js";
import { requireSession } from "../review/session.js";

/**
 * The instructions depend on the team: which tracker, which code format, which
 * tools. That lives in an extension, so nothing about a particular company ends
 * up in this server. Without one, the prompt stays generic and still works.
 */
function steps(tracker: TaskTracker | undefined): string {
  const trackerName = tracker?.name ?? "el gestor de tareas";
  const pattern = tracker?.codePattern
    ? `con la forma \`${tracker.codePattern}\``
    : "con el formato que use tu equipo";
  const example = tracker?.codeExample ? ` (por ejemplo ${tracker.codeExample})` : "";

  const lookup = tracker?.instructions
    ? tracker.instructions
    : `Consulta ${trackerName} con las herramientas que tengas conectadas. Si no hay ninguna disponible, dilo y sigue sin ese contexto.`;

  return [
    `1. Busca en el título y en la descripción un código de tarea ${pattern}${example}.`,
    "   Puede venir entre corchetes.",
    "",
    '2. Si NO hay ningún código: registra found: false con reason "el PR no referencia',
    '   ninguna tarea" y termina. No es un error; hay PRs que no la llevan.',
    "",
    `3. Si hay código: ${lookup}`,
    "   Quédate con qué pide la tarea, su título y su URL.",
    "",
    "4. Si el gestor de tareas no está disponible, no responde o no encuentra el código,",
    "   registra found: false explicando cuál de las tres cosas pasó. La revisión sigue",
    "   sin ese contexto: es información extra, no un requisito.",
  ].join("\n");
}

export function registerTaskContextPrompt(server: McpServer): void {
  server.registerPrompt(
    "task_context",
    {
      title: "[Step 2.1] Buscar el contexto de la tarea",
      description:
        "Segundo paso. Busca en el gestor de tareas qué se pidió en este pull request, para poder revisarlo contra lo que debía hacer y no solo contra sí mismo. Se resuelve una vez por revisión. Registra el resultado con record_task_context.",
      argsSchema: {
        reviewId: z.string().describe("El reviewId que devolvió start_review."),
      },
    },
    async ({ reviewId }) => {
      const session = requireSession(reviewId);
      const tracker = await taskTracker();

      const text = [
        `Busca el contexto de la tarea del PR #${session.prNumber}, para saber qué se pidió antes de revisar el código.`,
        "",
        "## El pull request",
        `Título: ${session.title}`,
        `Autor: ${session.author}`,
        "",
        session.body
          ? `Descripción:\n${session.body}`
          : "Descripción: (el autor no escribió ninguna)",
        "",
        "## Qué hacer",
        steps(tracker),
        "",
        "## Cómo registrarlo",
        `Llama a record_task_context con el reviewId ${session.id}. En summary escribe
qué pide la tarea con tus palabras, en dos o tres frases: eso es lo que verán
todos los pasos siguientes, así que tiene que bastarse solo. No copies la
descripción entera.`,
      ].join("\n");

      return {
        messages: [{ role: "user", content: { type: "text", text } }],
      };
    },
  );
}
