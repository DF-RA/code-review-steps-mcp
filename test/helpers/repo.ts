import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A fixed identity, so the fixture does not depend on the git config of whoever
 * runs the tests, and does not pick up a signing key from it either.
 */
const IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

export interface TempRepo {
  /** Absolute path of the clone. */
  dir: string;
  git(...args: string[]): Promise<string>;
  /** Writes a file, creating the directories it needs. */
  write(path: string, content: string): Promise<void>;
  /** Stages everything and commits it. */
  commit(message: string): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * A throwaway git repository on disk.
 *
 * The modules that read a clone (`git.ts`, `changed-files.ts`, `file-diff.ts`)
 * are only worth testing against real git output: a hand-written diff would
 * prove that the parser reads the fixture, not that it reads git.
 */
export async function createTempRepo(): Promise<TempRepo> {
  const dir = await mkdtemp(join(tmpdir(), "code-review-steps-test-"));

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", args, {
      cwd: dir,
      env: { ...process.env, ...IDENTITY },
    });

    return stdout;
  };

  await git("init", "--quiet", "--initial-branch=main");

  const repo: TempRepo = {
    dir,
    git,
    async write(path, content) {
      const target = join(dir, path);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    },
    async commit(message) {
      await git("add", "--all");
      await git("commit", "--quiet", "--message", message);
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };

  return repo;
}

/** Lines "1".."count", each on its own line, for diffs that need real bulk. */
export function numberedLines(count: number, offset = 0): string {
  return `${Array.from({ length: count }, (_, index) => `line ${index + 1 + offset}`).join("\n")}\n`;
}
