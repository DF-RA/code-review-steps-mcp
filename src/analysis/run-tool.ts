import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { UserFacingError } from "../errors.js";
import { dockerArgs, dockerEnabled } from "./docker.js";
import { AnalyzerUnavailableError, type DockerImage } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 64 * 1024 * 1024;

interface ExecFailure {
  code?: string | number;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface RunToolOptions {
  cwd: string;
  /** Linters exit non-zero when they find something: that is a result. */
  okExitCodes?: number[];
  timeoutMs?: number;
  installHint: string;
  analyzer: string;
  /** Used when the binary is missing from the machine. */
  docker?: DockerImage;
}

/** Pulling an image the first time is far slower than the analysis itself. */
const DOCKER_TIMEOUT_MS = 900_000;

/**
 * Runs an analyzer binary and returns its stdout.
 * Never goes through a shell: paths come from the repository and must not be
 * interpreted as a command line.
 */
async function exec(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
  });

  return stdout;
}

function interpret(failure: ExecFailure, options: RunToolOptions): string | never {
  if (typeof failure.code === "number" && (options.okExitCodes ?? []).includes(failure.code)) {
    return failure.stdout ?? "";
  }

  if (failure.killed) {
    throw new UserFacingError(`${options.analyzer} superó el tiempo límite.`);
  }

  throw new UserFacingError(
    `${options.analyzer} falló: ${(failure.stderr ?? "").trim() || "sin mensaje de error"}`,
  );
}

/**
 * Runs an analyzer and returns its stdout.
 * Falls back to Docker when the binary is not installed, so a missing tool does
 * not force the user to install anything. Never goes through a shell: paths come
 * from the repository and must not be interpreted as a command line.
 */
export async function runTool(
  command: string,
  args: string[],
  options: RunToolOptions,
): Promise<string> {
  try {
    return await exec(command, args, options.cwd, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    const failure = error as ExecFailure;

    if (failure.code !== "ENOENT") {
      return interpret(failure, options);
    }

    if (!options.docker || !dockerEnabled()) {
      throw new AnalyzerUnavailableError(options.analyzer, options.installHint);
    }

    // The binary is missing: try the pinned image instead.
    try {
      return await exec(
        "docker",
        dockerArgs(options.docker, options.cwd, args),
        options.cwd,
        DOCKER_TIMEOUT_MS,
      );
    } catch (dockerError) {
      const dockerFailure = dockerError as ExecFailure;

      if (dockerFailure.code === "ENOENT") {
        throw new AnalyzerUnavailableError(
          options.analyzer,
          `${options.installHint} Tampoco hay Docker para usar la imagen ${options.docker.image}.`,
        );
      }

      return interpret(dockerFailure, options);
    }
  }
}


export function parseJson<T>(stdout: string, analyzer: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new UserFacingError(`No se pudo interpretar el informe de ${analyzer} como JSON.`);
  }
}
