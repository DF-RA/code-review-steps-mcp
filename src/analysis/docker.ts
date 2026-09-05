import type { DockerImage } from "./types.js";

/** Where the repository is mounted inside the container. */
export const CONTAINER_WORKDIR = "/src";

export const DOCKER_ENV_VAR = "CODE_REVIEW_MCP_DOCKER";

export function dockerEnabled(): boolean {
  return process.env[DOCKER_ENV_VAR]?.trim().toLowerCase() !== "off";
}

/**
 * Wraps a tool invocation in `docker run`.
 * The mount is read-only and the container runs as the current user: analyzing
 * code must not be able to write to the repository or leave root-owned files.
 */
export function dockerArgs(
  docker: DockerImage,
  cwd: string,
  toolArgs: string[],
): string[] {
  const args = [
    "run",
    "--rm",
    "--volume",
    `${cwd}:${CONTAINER_WORKDIR}:ro`,
    "--workdir",
    CONTAINER_WORKDIR,
  ];

  for (const mount of docker.mounts ?? []) {
    args.push("--volume", `${mount.host}:${mount.container}:ro`);
  }

  if (!docker.network) {
    args.push("--network", "none");
  }

  if (process.getuid && process.getgid) {
    args.push("--user", `${process.getuid()}:${process.getgid()}`);
  }

  if (docker.entrypoint) {
    args.push("--entrypoint", docker.entrypoint);
  }

  args.push(docker.image, ...(docker.args ?? toolArgs));

  return args;
}
