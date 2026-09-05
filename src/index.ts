#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // stdout carries the MCP protocol: every log must go to stderr.
  console.error(`${SERVER_NAME} running on stdio`);
}

main().catch((error: unknown) => {
  console.error(`Fatal error starting ${SERVER_NAME}:`, error);
  process.exit(1);
});
