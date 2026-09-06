import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = "code-review-steps";
export const SERVER_VERSION = "0.1.0";

/**
 * Builds the MCP server with every primitive registered.
 * Transport-agnostic on purpose: the caller decides how to connect it.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}
