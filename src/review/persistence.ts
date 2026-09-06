import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { Finding } from "../analysis/types.js";
import { UserFacingError } from "../errors.js";
import type { ReviewComment } from "./comments.js";
import type { ReviewSession } from "./session.js";

/** Bumped when the shape changes, so an old file fails loudly instead of oddly. */
const FORMAT_VERSION = 1;

const DEFAULT_DIR = join(homedir(), ".code-review-steps");

interface StoredSession {
  version: number;
  savedAt: string;
  session: Omit<ReviewSession, "reviews" | "analysis"> & {
    reviews?: [string, ReviewComment[]][];
    analysis?: {
      tools: string[];
      skipped: { tool: string; reason: string }[];
      findingsByFile: [string, Finding[]][];
      unanalyzed: string[];
    };
  };
}

/** Maps do not survive JSON, so they travel as pairs. */
export function serialize(session: ReviewSession): string {
  const stored: StoredSession = {
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    session: {
      ...session,
      reviews: session.reviews ? [...session.reviews] : undefined,
      analysis: session.analysis
        ? { ...session.analysis, findingsByFile: [...session.analysis.findingsByFile] }
        : undefined,
    },
  };

  return `${JSON.stringify(stored, null, 2)}\n`;
}

export function deserialize(raw: string, from: string): ReviewSession {
  let stored: StoredSession;

  try {
    stored = JSON.parse(raw) as StoredSession;
  } catch {
    throw new UserFacingError(`El archivo ${from} no es un JSON válido.`);
  }

  if (stored.version !== FORMAT_VERSION) {
    throw new UserFacingError(
      `El archivo ${from} usa el formato ${stored.version} y este servidor lee el ${FORMAT_VERSION}. Se guardó con otra versión del MCP.`,
    );
  }

  const data = stored.session;

  if (!data?.id || !data.repoPath || !data.range) {
    throw new UserFacingError(`El archivo ${from} no contiene una revisión completa.`);
  }

  return {
    ...data,
    reviews: data.reviews ? new Map(data.reviews) : undefined,
    analysis: data.analysis
      ? { ...data.analysis, findingsByFile: new Map(data.analysis.findingsByFile) }
      : undefined,
  } as ReviewSession;
}

/** Default file for a review: one per pull request and repository. */
export function defaultPath(session: ReviewSession): string {
  const repo = session.repoPath.split("/").filter(Boolean).pop() ?? "repo";

  return join(DEFAULT_DIR, `${repo}-pr${session.prNumber}.json`);
}

export async function writeExport(session: ReviewSession, file?: string): Promise<string> {
  const target = file ? (isAbsolute(file) ? file : resolve(file)) : defaultPath(session);

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialize(session), "utf8");

  return target;
}

export async function readExport(file: string): Promise<ReviewSession> {
  const target = isAbsolute(file) ? file : resolve(file);

  try {
    return deserialize(await readFile(target, "utf8"), target);
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw error;
    }

    throw new UserFacingError(
      `No se pudo leer ${target}. Comprueba la ruta; los exports van por defecto a ${DEFAULT_DIR}.`,
    );
  }
}
