import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { UserFacingError } from "../errors.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export class GitError extends UserFacingError {}

interface ExecFailure {
  code?: string;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

function describeFailure(failure: ExecFailure): string {
  if (failure.code === "ENOENT") {
    return "No se encontró el comando `git`.";
  }

  if (failure.killed || failure.signal === "SIGTERM") {
    return `El comando git superó el tiempo límite de ${GIT_TIMEOUT_MS / 1000}s.`;
  }

  return (failure.stderr ?? "").trim() || "El comando git falló sin devolver un mensaje de error.";
}

/**
 * Runs git inside a clone.
 * Like runGh, never goes through a shell: refs come from the model and must not
 * be interpreted as a command line.
 */
export async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });

    return stdout;
  } catch (error) {
    throw new GitError(describeFailure(error as ExecFailure));
  }
}

/** Whether the ref resolves to a commit in this clone. */
export async function refExists(ref: string, cwd: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks the ref to compare against, preferring the remote-tracking branch:
 * it reflects what GitHub sees, while the local branch may be stale.
 */
export async function resolveBranchRef(branch: string, cwd: string): Promise<string | undefined> {
  for (const candidate of [`origin/${branch}`, branch]) {
    if (await refExists(candidate, cwd)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Range for the diff of a pull request.
 * Three dots: compares against the merge base, so commits that landed on the
 * destination branch after the PR started do not show up as changes of the PR.
 */
export async function resolveRange(
  cwd: string,
  baseBranch: string,
  headBranch: string,
): Promise<string> {
  const refs: string[] = [];

  for (const branch of [baseBranch, headBranch]) {
    const ref = await resolveBranchRef(branch, cwd);

    if (!ref) {
      throw new GitError(
        `El clon no tiene la rama "${branch}" (ni como origin/${branch}). Haz \`git fetch\` en ${cwd}.`,
      );
    }

    refs.push(ref);
  }

  return `${refs[0]}...${refs[1]}`;
}

/** Commit a ref points at. Used to key caches: a new push changes it. */
export async function revParse(ref: string, cwd: string): Promise<string> {
  const stdout = await runGit(["rev-parse", "--verify", `${ref}^{commit}`], cwd);

  return stdout.trim();
}
