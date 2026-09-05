import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Finding } from "../analysis/types.js";
import { reviewGuidance } from "../extensions/extension.js";
import { fileDiff } from "../file-diff.js";
import type { ChangedFile } from "../changed-files.js";
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
      title: "Revisar un archivo del PR",
      description:
        "Quinto paso. Construye la revisión de un archivo con todo el contexto: su estado en el PR, los problemas que detectaron las herramientas, el diff y la descripción de la tarea. El agente analiza desde cinco roles y registra el resultado con record_file_review.",
      argsSchema: {
        reviewId: z.string().describe("El reviewId que devolvió start_review."),
        path: z.string().describe("Ruta del archivo, de las que devolvió get_pr_files."),
      },
    },
    async ({ reviewId, path }) => {
      const session = requireSession(reviewId);
      const files = requireFiles(session);
      const analysis = requireAnalysis(session);
      const task = requireTaskContext(session);
      const guidance = await reviewGuidance();

      const cleanPath = path.trim();
      const file = files.find((candidate) => candidate.path === cleanPath);

      if (!file) {
        throw new Error(
          `"${cleanPath}" no está entre los archivos del PR. Usa una ruta de get_pr_files.`,
        );
      }

      const findings = analysis.findingsByFile.get(cleanPath) ?? [];
      const analyzed = !analysis.unanalyzed.includes(cleanPath) && analysis.tools.length > 0;

      const diff =
        file.status === "deleted"
          ? "El archivo fue eliminado por este PR."
          : (await fileDiff(session.repoPath, session.range, cleanPath)).diff;

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
