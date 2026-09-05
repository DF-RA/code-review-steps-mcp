import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { UserFacingError } from "../errors.js";

const execFileAsync = promisify(execFile);

/** Token read from the MCP server configuration (the `env` block of the client). */
export const TOKEN_ENV_VAR = "CODE_REVIEW_MCP_GITHUB_TOKEN";

const GH_TIMEOUT_MS = 20_000;
const GH_MAX_BUFFER = 10 * 1024 * 1024;

/** Failure of the gh CLI already translated into something the caller can act on. */
export class GhError extends UserFacingError {}

interface ExecFailure {
  code?: string;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

/**
 * Environment for the gh subprocess.
 * A token coming from the server configuration wins: gh reads GH_TOKEN before
 * GITHUB_TOKEN and before the keyring session, so this also neutralises a stale
 * GITHUB_TOKEN inherited from the client environment.
 */
function ghEnv(): NodeJS.ProcessEnv {
  const token = process.env[TOKEN_ENV_VAR]?.trim();

  if (!token) {
    return process.env;
  }

  return { ...process.env, GH_TOKEN: token };
}

export function hasConfiguredToken(): boolean {
  return Boolean(process.env[TOKEN_ENV_VAR]?.trim());
}

/** Turns a raw exec failure into a message that says what to do about it. */
function describeFailure(failure: ExecFailure): string {
  if (failure.code === "ENOENT") {
    return "No se encontró el CLI `gh`. Instálalo (https://cli.github.com) o configura un token en el servidor MCP.";
  }

  if (failure.killed || failure.signal === "SIGTERM") {
    return `La consulta a GitHub superó el tiempo límite de ${GH_TIMEOUT_MS / 1000}s.`;
  }

  const stderr = (failure.stderr ?? "").trim();
  const lower = stderr.toLowerCase();

  if (lower.includes("could not resolve to a pullrequest") || lower.includes("no pull requests found")) {
    return `GitHub no encontró ese PR. Revisa el número y el repositorio.\n${stderr}`;
  }

  if (lower.includes("not a git repository") || lower.includes("no git remotes found")) {
    return "El servidor no está corriendo dentro de un repositorio git, así que no puede deducir el repositorio. Pasa el argumento `repo` con el formato owner/nombre.";
  }

  if (lower.includes("authentication") || lower.includes("gh auth login") || lower.includes("bad credentials") || lower.includes("401")) {
    const hint = hasConfiguredToken()
      ? `El token de ${TOKEN_ENV_VAR} fue rechazado por GitHub. Revisa que sea válido y que tenga el scope \`repo\`.`
      : `No hay token configurado en el servidor MCP. Añade ${TOKEN_ENV_VAR} al bloque \`env\` de la configuración, o autentica el CLI con \`gh auth login\`.`;

    return `GitHub rechazó la autenticación. ${hint}\n${stderr}`;
  }

  return stderr || "El CLI `gh` falló sin devolver un mensaje de error.";
}

/**
 * Runs gh with a fixed argument list.
 * Never goes through a shell: arguments reaching this function come from the
 * model and must not be interpreted as a command line.
 */
export async function runGh(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd,
      env: ghEnv(),
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
    });

    return stdout;
  } catch (error) {
    throw new GhError(describeFailure(error as ExecFailure));
  }
}
