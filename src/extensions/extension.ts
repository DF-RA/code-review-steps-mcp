import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const EXTENSIONS_DIR_ENV_VAR = "CODE_REVIEW_MCP_EXTENSIONS_DIR";

const DEFAULT_DIR = join(homedir(), ".code-review-steps", "extensions");

/** How a team's issue tracker is referenced from its pull requests. */
export interface TaskTracker {
  /** Shown to the agent, e.g. "Jira". */
  name: string;
  /** Regular expression that matches a task code in the title or description. */
  codePattern?: string;
  codeExample?: string;
  /** How to look the code up, including which tools to use. */
  instructions?: string;
}

/**
 * Declarative extension.
 *
 * Deliberately data and not code: this server already spawns subprocesses, and
 * loading arbitrary modules from a directory would widen that surface for very
 * little in return. An extension contributes text and patterns, nothing else.
 */
export interface Extension {
  name: string;
  description?: string;
  taskTracker?: TaskTracker;
  /** Team conventions added to the review prompt. */
  reviewGuidance?: string;
}

export function extensionsDir(): string {
  return process.env[EXTENSIONS_DIR_ENV_VAR]?.trim() || DEFAULT_DIR;
}

/**
 * Reads the extensions from disk on every call, so editing one takes effect
 * without restarting the server. A broken file is reported and skipped: one bad
 * extension must not take the review down with it.
 */
export async function loadExtensions(): Promise<Extension[]> {
  const dir = extensionsDir();
  let names: string[];

  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }

  const extensions: Extension[] = [];

  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as Extension;

      extensions.push({ ...parsed, name: parsed.name || name.replace(/\.json$/, "") });
    } catch (error) {
      // stderr: stdout carries the MCP protocol.
      console.error(`Extensión ${join(dir, name)} ignorada: ${String(error)}`);
    }
  }

  return extensions;
}

/** The first extension that declares one wins; there is only one tracker. */
export async function taskTracker(): Promise<TaskTracker | undefined> {
  return (await loadExtensions()).find((extension) => extension.taskTracker)?.taskTracker;
}

/** Every extension can add guidance, and all of it reaches the reviewer. */
export async function reviewGuidance(): Promise<string[]> {
  return (await loadExtensions())
    .map((extension) => extension.reviewGuidance?.trim())
    .filter((guidance): guidance is string => Boolean(guidance));
}
