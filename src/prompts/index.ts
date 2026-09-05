import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerReviewFilePrompt } from "./review-file.js";
import { registerTaskContextPrompt } from "./task-context.js";

/** Add one line here for every new prompt module. */
export function registerPrompts(server: McpServer): void {
  registerTaskContextPrompt(server);
  registerReviewFilePrompt(server);
}
