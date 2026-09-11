#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, createServer } from "./server.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads the .env next to the server, if there is one.
 *
 * The configuration then travels with the server instead of with whoever
 * launches it, so the Inspector and a plain `node dist/index.js` see the same
 * token as the MCP client does through its `env` block. The real environment
 * still wins — loadEnvFile does not overwrite what is already set — so that
 * `env` block keeps the last word and the file only fills in the gaps.
 */
function loadLocalEnv(): void {
  try {
    process.loadEnvFile(join(PACKAGE_ROOT, ".env"));
  } catch {
    // No .env, or it cannot be read: the environment alone decides.
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

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
