import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { COMMENT_SEVERITIES, type CommentSeverity } from "../review/comments.js";
import { commentLayoutDoc, commentLayoutFor } from "../review/layout-doc.js";

const RESOURCE_URI = "review://comment-layout";

function isSeverity(value: string): value is CommentSeverity {
  return (COMMENT_SEVERITIES as readonly string[]).includes(value);
}

export function registerCommentLayout(server: McpServer): void {
  // The whole document, as a plain resource.
  server.registerResource(
    "comment-layout",
    RESOURCE_URI,
    {
      title: "Layout de los comentarios",
      description:
        "Formato con el que se publican los comentarios de la revisión, con un ejemplo de cada severidad y de cada tipo de anclaje.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: commentLayoutDoc() }],
    }),
  );

  // Parameterized by severity: a family of resources, one per severity, which is
  // what a resource template is for. The completion lets the client offer the
  // four valid values instead of the user having to know them.
  server.registerResource(
    "comment-layout-by-severity",
    new ResourceTemplate(`${RESOURCE_URI}/{severity}`, {
      list: undefined,
      complete: {
        severity: (value: string) =>
          COMMENT_SEVERITIES.filter((severity) => severity.startsWith(value)),
      },
    }),
    {
      title: "Layout de una severidad",
      description:
        "El formato y los ejemplos de una severidad concreta: blocker, issue, suggestion o question.",
      mimeType: "text/markdown",
    },
    async (uri, { severity }) => {
      const value = Array.isArray(severity) ? severity[0] : severity;

      if (!value || !isSeverity(value)) {
        // The spec requires -32602 when the resource does not exist.
        throw new McpError(
          ErrorCode.InvalidParams,
          `Severidad desconocida: "${value}". Las válidas son ${COMMENT_SEVERITIES.join(", ")}.`,
        );
      }

      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: commentLayoutFor(value) }],
      };
    },
  );
}
