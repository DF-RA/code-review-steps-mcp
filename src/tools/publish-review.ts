import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { changedLinesByFile } from "../analysis/changed-lines.js";
import { renderDraftComment, type DraftComment } from "../draft/draft.js";
import { UserFacingError } from "../errors.js";
import { runGit } from "../git/git.js";
import { runGh } from "../github/gh.js";
import { requireSession, type ReviewSession } from "../review/session.js";

const REVIEW_EVENTS = ["COMMENT", "REQUEST_CHANGES", "APPROVE"] as const;

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
  event: z
    .enum(REVIEW_EVENTS)
    .optional()
    .describe(
      "Tipo de review. Si se omite, NO se publica nada: se devuelve lo que se publicaría para que la persona elija. COMMENT deja observaciones sin aprobar ni bloquear; REQUEST_CHANGES bloquea el merge; APPROVE aprueba el PR.",
    ),
};

const outputSchema = {
  reviewId: z.string(),
  published: z.boolean(),
  event: z.string().optional(),
  url: z.string().optional(),
  inline: z.number(),
  onFile: z.number(),
  onPr: z.number(),
  demoted: z.array(z.string()),
  blockers: z.number(),
};

interface GhComment {
  path: string;
  body: string;
  line?: number;
  start_line?: number;
  side?: "RIGHT";
  subject_type?: "file";
}

/** GitHub only accepts inline comments on lines that appear in the diff. */
async function commentableLines(session: ReviewSession): Promise<Map<string, Set<number>>> {
  return changedLinesByFile(
    await runGit(["diff", "--unified=0", session.range], session.repoPath),
  );
}

function approved(session: ReviewSession): DraftComment[] {
  return (session.draft?.comments ?? []).filter((comment) => comment.status === "valid");
}

interface Payload {
  body: string;
  comments: GhComment[];
  demoted: string[];
}

function buildPayload(comments: DraftComment[], lines: Map<string, Set<number>>): Payload {
  const inline: GhComment[] = [];
  const prLevel: string[] = [];
  const demoted: string[] = [];

  for (const comment of comments) {
    const rendered = renderDraftComment(comment);

    if (comment.scope === "pr" || !comment.path) {
      prLevel.push(rendered);
      continue;
    }

    if (comment.scope === "file" || comment.line === undefined) {
      inline.push({ path: comment.path, body: rendered, subject_type: "file" });
      continue;
    }

    // A line the pull request did not touch would be rejected by the API, so it
    // becomes a file comment instead of losing the whole publication.
    if (!lines.get(comment.path)?.has(comment.line)) {
      demoted.push(`${comment.path} L${comment.line} — ${comment.title}`);
      inline.push({
        path: comment.path,
        body: `${rendered}\n\n_(sobre la línea ${comment.line}, que no forma parte del diff)_`,
        subject_type: "file",
      });
      continue;
    }

    const entry: GhComment = { path: comment.path, line: comment.line, side: "RIGHT", body: rendered };

    if (comment.endLine && comment.endLine > comment.line) {
      entry.start_line = comment.line;
      entry.line = comment.endLine;
    }

    inline.push(entry);
  }

  const body = [
    "## Revisión automática",
    "",
    ...(prLevel.length > 0 ? [prLevel.join("\n\n")] : ["Los comentarios van en las líneas del diff."]),
  ].join("\n");

  return { body, comments: inline, demoted };
}

async function repoSlug(cwd: string): Promise<string> {
  const stdout = await runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd);
  const slug = stdout.trim();

  if (!slug) {
    throw new UserFacingError("No se pudo determinar el repositorio de GitHub desde el clon.");
  }

  return slug;
}

export function registerPublishReview(server: McpServer): void {
  server.registerTool(
    "publish_review",
    {
      title: "Publicar la revisión en el PR",
      description:
        "Publica en GitHub, como un review del pull request, los comentarios que la persona dio por válidos. Llamarla SIN `event` no publica nada: devuelve lo que se publicaría y cuántos bloqueantes hay, para que la persona elija el tipo de review. Solo publica cuando se le pasa `event`. Es la única tool del flujo que escribe fuera de la máquina, y no se puede deshacer: los comentarios quedan en el PR y le llegan al equipo.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId, event }) => {
      try {
        const session = requireSession(reviewId);

        if (!session.draft) {
          throw new UserFacingError("Todavía no hay borrador. Créalo con create_draft.");
        }

        const comments = approved(session);

        if (comments.length === 0) {
          throw new UserFacingError(
            "No hay ningún comentario marcado como válido, así que no hay nada que publicar.",
          );
        }

        const payload = buildPayload(comments, await commentableLines(session));
        const blockers = comments.filter((comment) => comment.severity === "blocker").length;
        const onPr = comments.filter((comment) => comment.scope === "pr").length;
        const onFile = payload.comments.filter((comment) => comment.subject_type === "file").length;
        const inline = payload.comments.length - onFile;

        const counts = {
          reviewId: session.id,
          inline,
          onFile,
          onPr,
          demoted: payload.demoted,
          blockers,
        };

        // Without an explicit event nothing is published: publishing is
        // irreversible and the person has to choose how it lands.
        if (!event) {
          const lines = [
            `Listo para publicar en el PR #${session.prNumber}: ${comments.length} comentario(s).`,
            `  · ${inline} en líneas del diff`,
            `  · ${onFile} sobre el archivo completo`,
            `  · ${onPr} en el cuerpo del review`,
            `  · ${blockers} de severidad blocker`,
          ];

          if (payload.demoted.length > 0) {
            lines.push(
              "",
              "Estos apuntaban a líneas que el PR no toca, así que irán como comentario de archivo:",
              ...payload.demoted.map((entry) => `  · ${entry}`),
            );
          }

          lines.push(
            "",
            "No he publicado nada todavía. Pregunta a la persona con qué tipo quiere publicarlo y vuelve a llamarme con `event`:",
            "  · COMMENT — deja los comentarios sin aprobar ni bloquear el merge",
            "  · REQUEST_CHANGES — pide cambios y bloquea el merge",
            "  · APPROVE — aprueba el pull request",
          );

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            structuredContent: { ...counts, published: false },
          };
        }

        const slug = await repoSlug(session.repoPath);

        // The payload goes through a file: gh reads it with --input, and a
        // review with many comments does not fit on a command line anyway.
        const dir = await mkdtemp(join(tmpdir(), "code-review-publish-"));
        const payloadPath = join(dir, "review.json");
        let stdout: string;

        try {
          await writeFile(
            payloadPath,
            JSON.stringify({ event, body: payload.body, comments: payload.comments }),
            "utf8",
          );

          stdout = await runGh(
            ["api", "--method", "POST", `repos/${slug}/pulls/${session.prNumber}/reviews`, "--input", payloadPath],
            session.repoPath,
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }

        const created = JSON.parse(stdout) as { html_url?: string };

        return {
          content: [
            {
              type: "text",
              text: [
                `Publicado como review ${event} en el PR #${session.prNumber}.`,
                `${comments.length} comentario(s): ${inline} en línea, ${onFile} de archivo, ${onPr} en el cuerpo.`,
                created.html_url ? `Míralo aquí: ${created.html_url}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          structuredContent: { ...counts, published: true, event, url: created.html_url },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError
            ? error.message
            : `Error inesperado: ${String((error as { stderr?: string }).stderr ?? error)}`;

        return {
          content: [{ type: "text", text: `No se pudo publicar la revisión.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
