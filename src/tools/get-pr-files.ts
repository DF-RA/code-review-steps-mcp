import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CHANGE_STATUSES, listChangedFiles, type ChangedFile } from "../changed-files.js";
import { UserFacingError } from "../errors.js";
import { requireSession, requireTaskContext, type ReviewSession } from "../review/session.js";

const inputSchema = {
  reviewId: z.string().describe("El reviewId que devolvió start_review."),
};

const outputSchema = {
  reviewId: z.string(),
  prNumber: z.number(),
  range: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(CHANGE_STATUSES),
      previousPath: z.string().optional(),
    }),
  ),
};

const GROUPS: { status: ChangedFile["status"]; label: string; mark: string }[] = [
  { status: "added", label: "Añadidos", mark: "+" },
  { status: "modified", label: "Modificados", mark: "~" },
  { status: "deleted", label: "Eliminados", mark: "-" },
  { status: "renamed", label: "Renombrados", mark: "→" },
  { status: "copied", label: "Copiados", mark: "→" },
  { status: "type-changed", label: "Cambio de tipo", mark: "!" },
  { status: "unknown", label: "Sin clasificar", mark: "?" },
];

function format(session: ReviewSession, files: ChangedFile[]): string {
  const lines = [`PR #${session.prNumber} — ${files.length} archivo(s) · rango ${session.range}`];

  for (const group of GROUPS) {
    const inGroup = files.filter((file) => file.status === group.status);

    if (inGroup.length === 0) {
      continue;
    }

    lines.push("", `${group.label} (${inGroup.length})`);

    for (const file of inGroup) {
      const name = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
      lines.push(`  ${group.mark} ${name}`);
    }
  }

  lines.push("", "Siguiente: analyze_pr con este reviewId.");

  return lines.join("\n");
}

export function registerGetPrFiles(server: McpServer): void {
  server.registerTool(
    "get_pr_files",
    {
      title: "Listar los archivos del PR",
      description:
        "Tercer paso. Lista los archivos que el pull request añade, modifica o elimina, agrupados por tipo de cambio, y los deja guardados en la revisión. Los pasos siguientes solo aceptan rutas de esta lista. Requiere el reviewId de start_review.",
      inputSchema,
      outputSchema,
    },
    async ({ reviewId }) => {
      try {
        const session = requireSession(reviewId);
        requireTaskContext(session);

        const files = await listChangedFiles(session.repoPath, session.range);

        // Stored on the session: the next steps read from here, they do not
        // recompute it.
        session.files = files;

        return {
          content: [{ type: "text", text: format(session, files) }],
          structuredContent: {
            reviewId: session.id,
            prNumber: session.prNumber,
            range: session.range,
            files,
          },
        };
      } catch (error) {
        const message =
          error instanceof UserFacingError ? error.message : `Error inesperado: ${String(error)}`;

        return {
          content: [{ type: "text", text: `No se pudieron listar los archivos.\n${message}` }],
          isError: true,
        };
      }
    },
  );
}
