import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCommentLayout } from "./comment-layout.js";

/** Add one line here for every new resource module. */
export function registerResources(server: McpServer): void {
  registerCommentLayout(server);
}
