import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { UserFacingError } from "../errors.js";

export class InvalidTargetError extends UserFacingError {}

const SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SSH_PATTERN = /^(?:ssh:\/\/)?git@([^:/]+)[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * How the repository was identified.
 * A slug goes to `gh --repo`; a path becomes the working directory of gh, so it
 * resolves the remote the same way it would in a terminal opened there.
 */
export type RepoTarget =
  | { kind: "slug"; slug: string }
  | { kind: "path"; cwd: string }
  | { kind: "cwd" };

interface ParsedRepoUrl {
  host: string;
  slug: string;
  prNumber?: number;
}

/** gh takes HOST/OWNER/REPO for anything outside github.com. */
function qualifiedSlug(parsed: ParsedRepoUrl): string {
  return parsed.host === "github.com" ? parsed.slug : `${parsed.host}/${parsed.slug}`;
}

function parseHttpUrl(value: string): ParsedRepoUrl | undefined {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const [owner, rawName, ...rest] = url.pathname.split("/").filter(Boolean);

  if (!owner || !rawName) {
    return undefined;
  }

  const parsed: ParsedRepoUrl = {
    host: url.hostname,
    slug: `${owner}/${rawName.replace(/\.git$/, "")}`,
  };

  // .../pull/200, with or without anything after it (/files, /commits...).
  const pullIndex = rest.indexOf("pull");

  if (pullIndex !== -1) {
    const candidate = Number(rest[pullIndex + 1]);

    if (Number.isInteger(candidate) && candidate > 0) {
      parsed.prNumber = candidate;
    }
  }

  return parsed;
}

function parseSshUrl(value: string): ParsedRepoUrl | undefined {
  const match = SSH_PATTERN.exec(value);

  if (!match) {
    return undefined;
  }

  const [, host, owner, name] = match;

  if (!host || !owner || !name) {
    return undefined;
  }

  return { host, slug: `${owner}/${name}` };
}

function parseRepoUrl(value: string): ParsedRepoUrl | undefined {
  return parseHttpUrl(value) ?? parseSshUrl(value);
}

/**
 * A local path has to be absolute or explicitly relative: a bare `foo/bar` is
 * read as owner/name, which is the far more common case.
 */
function looksLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value === "." ||
    value === ".."
  );
}

function expandHome(value: string): string {
  if (value === "~") {
    return homedir();
  }

  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }

  return resolve(value);
}

async function assertGitRepository(dir: string): Promise<string> {
  let isDirectory: boolean;

  try {
    isDirectory = (await stat(dir)).isDirectory();
  } catch {
    throw new InvalidTargetError(`La ruta ${dir} no existe o no es accesible.`);
  }

  if (!isDirectory) {
    throw new InvalidTargetError(`La ruta ${dir} no es un directorio.`);
  }

  try {
    // Present as a directory in a normal clone, as a file in worktrees.
    await stat(join(dir, ".git"));
  } catch {
    throw new InvalidTargetError(`La ruta ${dir} no es un repositorio git: no contiene .git.`);
  }

  return dir;
}

/** Accepts owner/nombre, a local clone path, or a repository URL. */
export async function resolveRepoTarget(value?: string): Promise<RepoTarget> {
  const raw = value?.trim();

  // Clients send "" for optional fields left blank instead of omitting them.
  if (!raw) {
    return { kind: "cwd" };
  }

  if (looksLikePath(raw)) {
    return { kind: "path", cwd: await assertGitRepository(expandHome(raw)) };
  }

  const parsed = parseRepoUrl(raw);

  if (parsed) {
    return { kind: "slug", slug: qualifiedSlug(parsed) };
  }

  if (SLUG_PATTERN.test(raw)) {
    return { kind: "slug", slug: raw };
  }

  throw new InvalidTargetError(
    `No pude interpretar "${raw}" como repositorio. Usa owner/nombre, la ruta local del clon o la URL del repositorio en GitHub.`,
  );
}

export interface PullRequestRef {
  number: number;
  /** Present when the reference itself carried the repository. */
  slug?: string;
}

/** Accepts the number of the pull request or its full URL. */
export function parsePullRequestRef(value: string | number): PullRequestRef {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidTargetError(`El número de pull request debe ser un entero positivo, no ${value}.`);
    }
    return { number: value };
  }

  const raw = value.trim().replace(/^#/, "");

  if (/^\d+$/.test(raw)) {
    return { number: Number(raw) };
  }

  const parsed = parseRepoUrl(raw);

  if (parsed?.prNumber) {
    return { number: parsed.prNumber, slug: qualifiedSlug(parsed) };
  }

  throw new InvalidTargetError(
    `No pude interpretar "${value}" como pull request. Pasa el número (200) o la URL completa (https://github.com/owner/repo/pull/200).`,
  );
}
