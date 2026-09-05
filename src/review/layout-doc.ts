import {
  renderComment,
  signature,
  SIGNATURE_ENV_VAR,
  type CommentSeverity,
  type ReviewComment,
} from "./comments.js";

/** One example per scope, so the differences between them are visible. */
const EXAMPLES: { caption: string; comment: ReviewComment }[] = [
  {
    caption: "Anclado a una línea (lo normal)",
    comment: {
      scope: "line",
      path: "src/main/java/com/ejemplo/OrderService.java",
      line: 45,
      severity: "blocker",
      title: "La excepción se traga sin registrar",
      body: "El `catch` vacío hace que un fallo de la base de datos se vea como una orden procesada correctamente. Registra el error y propaga, o devuelve un resultado que el llamador pueda distinguir del caso bueno.",
    },
  },
  {
    caption: "Rango de líneas",
    comment: {
      scope: "line",
      path: "src/main/java/com/ejemplo/OrderService.java",
      line: 78,
      endLine: 92,
      severity: "issue",
      title: "Lógica duplicada de OrderMapper",
      body: "Este bloque repite lo que ya hace `OrderMapper.toDomain`. Si cambia el mapeo, habrá que acordarse de tocar los dos sitios.",
    },
  },
  {
    caption: "Del archivo entero, cuando no se puede señalar una línea",
    comment: {
      scope: "file",
      path: "src/test/java/com/ejemplo/OrderServiceTest.java",
      severity: "suggestion",
      title: "Falta cubrir el rechazo con items",
      body: "El PR añade el camino de rechazo con items y aquí no hay ningún test que lo ejercite.",
    },
  },
  {
    caption: "Del PR, cuando no pertenece a ningún archivo",
    comment: {
      scope: "pr",
      severity: "question",
      title: "El pipeline lleva dos días en rojo",
      body: "El check `lint` falla desde el primer commit del PR. ¿Es un problema del cambio o venía roto de antes?",
    },
  },
];

const WHEN: Record<CommentSeverity, string> = {
  blocker: "El PR no debería mergearse así.",
  issue: "Hay que arreglarlo, pero no bloquea por sí solo.",
  suggestion: "Mejora opcional: quien lo lee decide.",
  question: "Falta información para poder juzgarlo.",
};

/** The layout for one severity, with its examples. */
export function commentLayoutFor(severity: CommentSeverity): string {
  const examples = EXAMPLES.filter((example) => example.comment.severity === severity);

  const lines = [
    `# Comentarios de severidad \`${severity}\``,
    "",
    WHEN[severity],
    "",
    "## Estructura",
    "",
    "```",
    "**<marca de severidad> — <título>**",
    "`<archivo>` L<línea>",
    "",
    "<cuerpo: qué pasa, por qué importa, qué hacer>",
    "",
    "---",
    `_${signature()}_`,
    "```",
    "",
  ];

  for (const example of examples) {
    lines.push(`## Ejemplo — ${example.caption}`, "", renderComment(example.comment), "");
  }

  if (examples.length === 0) {
    lines.push("_(no hay ejemplo registrado para esta severidad)_");
  }

  return lines.join("\n");
}

export function commentLayoutDoc(): string {
  const lines = [
    "# Layout de los comentarios",
    "",
    "Formato con el que se publican los comentarios de la revisión. Lo genera",
    "`renderComment`, y es lo que devuelve `record_file_review` en `rendered`.",
    "",
    "## Estructura",
    "",
    "```",
    "**<marca de severidad> — <título>**",
    "`<archivo>` L<línea>",
    "",
    "<cuerpo: qué pasa, por qué importa, qué hacer>",
    "",
    "---",
    `_${signature()}_`,
    "```",
    "",
    "La firma del final identifica que lo escribió una máquina, para que quien lo",
    `lea sepa cuánto fiarse. Se cambia con \`${SIGNATURE_ENV_VAR}\`.`,
    "",
    "## Severidades",
    "",
    "| Severidad | Marca | Cuándo |",
    "| --- | --- | --- |",
    "| `blocker` | 🛑 Bloqueante | No debería mergearse así |",
    "| `issue` | ⚠️ Problema | Hay que arreglarlo |",
    "| `suggestion` | 💡 Sugerencia | Mejora opcional |",
    "| `question` | ❓ Duda | Falta información para juzgarlo |",
    "",
    "## Ejemplos",
  ];

  for (const example of EXAMPLES) {
    lines.push("", `### ${example.caption}`, "", renderComment(example.comment));
  }

  return lines.join("\n");
}

