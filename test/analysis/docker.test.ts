import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONTAINER_WORKDIR, DOCKER_ENV_VAR, dockerArgs, dockerEnabled } from "../../src/analysis/docker.js";
import { stubEnv } from "../helpers/env.js";

/** The value that follows a flag, so the assertions do not count positions. */
function valuesOf(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []));
}

describe("dockerEnabled", () => {
  test("is on when the variable is not set", (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: undefined });

    assert.equal(dockerEnabled(), true);
  });

  test('is off only for the exact value "off", whatever its case or padding', (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "  OFF  " });

    assert.equal(dockerEnabled(), false);
  });

  test("stays on for any other value", (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "on" });

    assert.equal(dockerEnabled(), true);
  });
});

describe("dockerArgs", () => {
  test("mounts the clone read-only and works from it", () => {
    const args = dockerArgs({ image: "pmdcode/pmd:latest" }, "/home/me/repo", ["pmd", "check"]);

    assert.deepEqual(args.slice(0, 2), ["run", "--rm"]);
    assert.ok(valuesOf(args, "--volume").includes(`/home/me/repo:${CONTAINER_WORKDIR}:ro`));
    assert.deepEqual(valuesOf(args, "--workdir"), [CONTAINER_WORKDIR]);
  });

  test("cuts the network off unless the image asks for it", () => {
    const offline = dockerArgs({ image: "i" }, "/repo", []);
    const online = dockerArgs({ image: "i", network: true }, "/repo", []);

    assert.deepEqual(valuesOf(offline, "--network"), ["none"]);
    assert.equal(online.includes("--network"), false);
  });

  test("adds the extra mounts read-only, after the one of the clone", () => {
    const args = dockerArgs(
      { image: "i", mounts: [{ host: "/etc/rules", container: "/rulesets" }] },
      "/repo",
      [],
    );

    assert.deepEqual(valuesOf(args, "--volume"), [`/repo:${CONTAINER_WORKDIR}:ro`, "/etc/rules:/rulesets:ro"]);
  });

  test("runs as the current user, so nothing lands on disk owned by root", () => {
    const args = dockerArgs({ image: "i" }, "/repo", []);

    assert.deepEqual(valuesOf(args, "--user"), [`${process.getuid?.()}:${process.getgid?.()}`]);
  });

  test("overrides the entrypoint only when the image declares one", () => {
    assert.deepEqual(valuesOf(dockerArgs({ image: "i", entrypoint: "/bin/pmd" }, "/repo", []), "--entrypoint"), [
      "/bin/pmd",
    ]);
    assert.equal(dockerArgs({ image: "i" }, "/repo", []).includes("--entrypoint"), false);
  });

  test("puts the image last, followed by the tool arguments", () => {
    const args = dockerArgs({ image: "pmdcode/pmd:latest" }, "/repo", ["check", "-f", "json"]);

    assert.deepEqual(args.slice(-4), ["pmdcode/pmd:latest", "check", "-f", "json"]);
  });

  test("replaces the tool arguments when the image brings its own", () => {
    // Paths differ inside the container, so an image can override them whole.
    const args = dockerArgs({ image: "i", args: ["check", "/src"] }, "/repo", ["check", "/home/me/repo"]);

    assert.deepEqual(args.slice(-3), ["i", "check", "/src"]);
  });
});
