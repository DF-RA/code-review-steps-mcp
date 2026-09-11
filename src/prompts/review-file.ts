import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Finding } from "../analysis/types.js";
import { reviewGuidance } from "../extensions/extension.js";
import { partOf, rawFileDiff, type FileDiff } from "../file-diff.js";
import type { ChangedFile } from "../changed-files.js";
import { findFileDiff } from "../review/db.js";
import {
  requireAnalysis,
  requireFiles,
  requireSession,
  requireTaskContext,
} from "../review/session.js";
import type { TaskContext } from "../review/task-context.js";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
  added: "NUEVO (no existía antes de este PR)",
  modified: "MODIFICADO",
  deleted: "ELIMINADO",
  renamed: "RENOMBRADO / MOVIDO",
  copied: "COPIADO",
  "type-changed": "CAMBIO DE TIPO",
  unknown: "SIN CLASIFICAR",
};

/** Resolved once in step 2, so every file is reviewed against the same task. */
function formatTask(task: TaskContext): string {
  if (!task.found) {
    return `No hay tarea asociada a este PR (${task.reason}). Revisa el cambio contra la descripción del pull request, y si algo del código no se explica ni por ella, dilo.`;
  }

  const lines = [
    `Tarea ${task.code ?? ""}${task.title ? ` — ${task.title}` : ""}`.trim(),
    task.summary ? `\nQué pide:\n${task.summary}` : "",
    task.url ? `\nEnlace: ${task.url}` : "",
  ];

  // Who the task is assigned to is deliberately left out: it is internal
  // information about people, and these comments end up published in the PR.
  return lines.filter(Boolean).join("\n");
}

/** Says which part of the diff this is, when it is not the whole of it. */
function describePart(part: FileDiff): string {
  const last = part.offset + part.hunksIncluded;
  const where = `Bloques ${part.offset + 1}-${last} de ${part.totalHunks}.`;

  return part.hasMore
    ? [
        `${where} FALTAN ${part.totalHunks - last} POR VER.`,
        `No registres todavía la revisión de este archivo: vuelve a pedir este prompt con offset: "${part.nextOffset}" hasta llegar al último bloque, y decide con el archivo entero delante.`,
        "",
      ].join("\n")
    : `${where} Es el último: ya has visto el archivo entero.`;
}

function formatFindings(findings: Finding[], analyzed: boolean, tools: string[]): string {
  if (!analyzed) {
    return "Ninguna herramienta cubre este lenguaje, así que aquí no hay red de seguridad automática: todo depende de tu lectura.";
  }

  if (findings.length === 0) {
    return `Las herramientas (${tools.join(", ")}) no encontraron nada. Cubren errores mecánicos, no diseño ni lógica de negocio: sigue revisando.`;
  }

  return [
    `Las herramientas (${tools.join(", ")}) señalaron esto. Son hechos verificados, no opiniones:`,
    "",
    ...findings.map(
      (finding) =>
        `- L${finding.line} · [${finding.severity}] ${finding.tool}/${finding.rule} — ${finding.message}`,
    ),
  ].join("\n");
}

const ROLES = `Analiza el archivo desde cinco perspectivas. Si dispones de sub-agentes,
lanza una por rol en paralelo; si no, recórrelas una a una. Cada rol recibe lo mismo:
el diff, los hallazgos de las herramientas y el contexto de la tarea.

1. PROGRAMADOR — ¿el código hace lo que dice? Casos límite, valores nulos o vacíos,
   ramas de error, condiciones de carrera, recursos sin cerrar, duplicación de lógica
   que ya existe en el repositorio, nombres que engañan.

2. QA — ¿está probado? Qué ramas nuevas quedan sin test, si los tests verifican
   comportamiento o detalles de implementación, qué caso de regresión falta, si algún
   test pasa siempre pase lo que pase.

3. ARQUITECTO — ¿está en el sitio correcto? Límites entre capas, dirección de las
   dependencias, lógica de negocio filtrándose a controladores o adaptadores,
   acoplamiento nuevo, contratos de API que cambian de forma incompatible.

4. PRODUCT MANAGER — ¿resuelve lo que se pidió? Contrasta el cambio con la
   descripción del PR y con la tarea, si la encontraste. Señala lo que falta del
   alcance y también lo que sobra: cambios que nadie pidió y que deberían ir aparte.

5. LÍDER DE PROYECTO — lee las cuatro revisiones anteriores, descarta lo que sea
   ruido o cuestión de gusto, resuelve las contradicciones entre roles y decide qué
   se queda. Su conclusión es la que se registra: los demás roles no escriben
   comentarios por su cuenta.`;

const RULES = `Reglas que no puedes saltarte:

- COMENTA SOLO LO QUE ESTÁ EN EL DIFF. Lo que ya existía antes de este PR no es
  asunto de esta revisión, aunque te parezca mejorable. El diff es el límite.
- UN COMENTARIO POR PUNTO, anclado a su línea. No agrupes varios problemas en un
  comentario: cada uno tiene que poder discutirse y resolverse por separado.
- Usa scope "file" solo cuando el punto sea del archivo entero y no puedas señalar
  una línea; y scope "pr" solo para lo que no pertenece a ningún archivo.
- No repitas lo que ya dijeron las herramientas: eso ya está reportado. Aporta lo
  que ellas no ven.
- Si no tienes nada que decir, no digas nada. Un comentario vacío o de cortesía le
  hace perder el tiempo a quien lee el PR.
- Sé concreto: qué está mal, por qué importa y qué hacer. Nada de "considerar
  revisar esto".
- ESTOS COMENTARIOS SE PUBLICAN EN EL PULL REQUEST y los lee todo el equipo.
  Habla del código, nunca de las personas: nada sobre quién tiene asignada la
  tarea, quién debería haber abierto el PR ni cómo trabaja nadie. Eso es
  información interna del proceso, no feedback de código.

La severidad no es decorativa: define el color con el que se publica el comentario
y cuánto pesa para quien lo lee. Reserva \`blocker\` para lo que de verdad no debería
mergearse; si todo es bloqueante, nada lo es.

Cuando termines, registra el resultado llamando a record_file_review con el reviewId,
la ruta del archivo y la lista de comentarios (vacía si no hay nada que señalar).`;

export function registerReviewFilePrompt(server: McpServer): void {
  server.registerPrompt(
    "review_file",
    {
      title: "[Step 6.1] Revisar un archivo del PR",
      description:
        "Quinto paso. Construye la revisión de un archivo con todo el contexto: su estado en el PR, los problemas que detectaron las herramientas, el diff y la descripción de la tarea. El archivo se indica con su pathId, el mismo que devolvió get_pr_files. El agente analiza desde cinco roles y registra el resultado con record_file_review.",
      argsSchema: {
        reviewId: z.string().describe("El reviewId que devolvió start_review."),
        pathId: z
          .string()
          .describe("Identificador del archivo (pathId), de los que devolvió get_pr_files."),
        offset: z
          .string()
          .optional()
          .describe(
            "Bloque por el que empezar, si el diff no cabe entero. Usa el que la parte anterior indicó como siguiente.",
          ),
      },
    },
    async ({ reviewId, pathId, offset }) => {
      const session = requireSession(reviewId);
      const files = requireFiles(session);
      const analysis = requireAnalysis(session);
      const task = requireTaskContext(session);
      const guidance = await reviewGuidance();

      const wanted = pathId.trim();
      const file = files.find((candidate) => candidate.pathId === wanted);

      if (!file) {
        // Passing the path is the easy slip right after the change, so answer
        // with the id that was wanted instead of just denying the one given.
        const byPath = files.find((candidate) => candidate.path === wanted);

        throw new Error(
          byPath
            ? `"${wanted}" es la ruta, no el pathId. El de ese archivo es ${byPath.pathId}.`
            : `No hay ningún archivo con pathId "${wanted}" entre los ${files.length} del PR. Usa uno de los que devolvió get_pr_files.`,
        );
      }

      const cleanPath = file.path;

      const findings = analysis.findingsByFile.get(cleanPath) ?? [];
      const analyzed = !analysis.unanalyzed.includes(cleanPath) && analysis.tools.length > 0;

      // Step 5 stored the whole diff of this file; reading it back beats asking
      // git to reprint the same text over commits that cannot move.
      let part: FileDiff | undefined;

      if (file.status !== "deleted") {
        // Prompt arguments arrive as strings: an unparseable one would silently
        // select no hunk at all and hand the agent an empty diff.
        const from = Number(offset ?? 0);

        if (!Number.isInteger(from) || from < 0) {
          throw new Error(
            `offset tiene que ser un entero de 0 en adelante, y llegó "${offset}".`,
          );
        }

        const stored = findFileDiff(session.id, file.pathId);
        const whole = stored?.diff ?? (await rawFileDiff(session.repoPath, session.range, cleanPath));

        part = partOf(whole, cleanPath, from);
      }

      const diff = part ? part.diff : "El archivo fue eliminado por este PR.";

      const sections = [
        `Estás revisando un archivo del PR #${session.prNumber} de ${session.repoPath}.`,
        "",
        "## El pull request",
        `Título: ${session.title}`,
        `Autor: ${session.author}`,
        `Rama: ${session.sourceBranch} → ${session.targetBranch}`,
        "",
        session.body ? `Descripción:\n${session.body}` : "Descripción: (el autor no escribió ninguna)",
        "",
        "## Contexto de la tarea",
        formatTask(task),
        "",
        "## El archivo",
        `Ruta: ${cleanPath}`,
        `Estado en el PR: ${STATUS_LABEL[file.status]}`,
        file.previousPath ? `Ruta anterior: ${file.previousPath}` : "",
        "",
        "## Lo que ya detectaron las herramientas",
        formatFindings(findings, analyzed, analysis.tools),
        "",
        "## El cambio",
        // A diff that does not fit comes in parts, and the agent has to know it
        // is looking at one: concluding on a third of a file, believing it saw
        // all of it, is the failure this line exists to prevent.
        ...(part && (part.hasMore || part.offset > 0) ? [describePart(part)] : []),
        "```diff",
        diff,
        "```",
        "",
        // Team conventions come from the extensions, so nothing specific to one
        // company lives in this server.
        ...(guidance.length > 0
          ? ["## Convenciones de tu equipo", guidance.join("\n\n"), ""]
          : []),
        "## Cómo revisarlo",
        ROLES,
        "",
        RULES,
      ].filter((section) => section !== "");

      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: sections.join("\n") },
          },
        ],
      };
    },
  );
}
