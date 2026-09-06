import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { commentLayoutDoc } from "../review/layout-doc.js";

/**
 * The same content as the review://comment-layout resource.
 * It exists as a tool too because not every client surfaces resources, and the
 * agent writing the comments has to be able to read the format it must follow.
 */
export function registerGetCommentLayout(server: McpServer): void {
  server.registerTool(
    "get_comment_layout",
    {
      title: "Ver el layout de los comentarios",
      description:
        "Devuelve el formato con el que se publican los comentarios de la revisión: la plantilla, las severidades disponibles y un ejemplo de cada tipo de anclaje (línea, archivo, PR). Consúltala antes de redactar comentarios si necesitas ver cómo van a quedar.",
      inputSchema: {},
      outputSchema: { layout: z.string() },
    },
    async () => {
      const layout = commentLayoutDoc();

      return {
        content: [{ type: "text", text: layout }],
        structuredContent: { layout },
      };
    },
  );
}
