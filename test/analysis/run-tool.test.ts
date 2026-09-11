import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseJson, runTool, type RunToolOptions } from "../../src/analysis/run-tool.js";
import { AnalyzerUnavailableError } from "../../src/analysis/types.js";
import { UserFacingError } from "../../src/errors.js";
import { stubEnv } from "../helpers/env.js";
import { DOCKER_ENV_VAR } from "../../src/analysis/docker.js";

/** Node itself stands in for an analyzer binary: it is always installed. */
const NODE = process.execPath;

function options(overrides: Partial<RunToolOptions> = {}): RunToolOptions {
  return {
    cwd: process.cwd(),
    analyzer: "FakeLint",
    installHint: "Instálalo con brew install fakelint.",
    ...overrides,
  };
}

describe("runTool", () => {
  test("returns the stdout of the tool", async () => {
    const stdout = await runTool(NODE, ["-e", "process.stdout.write('{}')"], options());

    assert.equal(stdout, "{}");
  });

  test("runs the tool in the given directory", async () => {
    const stdout = await runTool(NODE, ["-e", "process.stdout.write(process.cwd())"], options({ cwd: "/" }));

    assert.equal(stdout, "/");
  });

  test("treats an expected exit code as a result and keeps the report", async () => {
    // A linter exits non-zero when it found something; the findings are on stdout.
    const stdout = await runTool(
      NODE,
      ["-e", "process.stdout.write('[1]'); process.exit(4)"],
      options({ okExitCodes: [4] }),
    );

    assert.equal(stdout, "[1]");
  });

  test("turns an unexpected exit code into the message the tool printed", async () => {
    await assert.rejects(
      runTool(NODE, ["-e", "process.stderr.write('  boom  '); process.exit(2)"], options({ okExitCodes: [4] })),
      (error: unknown) => {
        assert.ok(error instanceof UserFacingError);
        assert.equal(error.message, "FakeLint falló: boom");
        return true;
      },
    );
  });

  test("says so explicitly when the tool failed without a message", async () => {
    await assert.rejects(
      runTool(NODE, ["-e", "process.exit(2)"], options()),
      /FakeLint falló: sin mensaje de error/u,
    );
  });

  test("reports a tool that ran past its time limit", async () => {
    await assert.rejects(
      runTool(NODE, ["-e", "setTimeout(() => {}, 30000)"], options({ timeoutMs: 250 })),
      /FakeLint superó el tiempo límite\./u,
    );
  });

  test("reports a missing binary as unavailable, with the install hint", async () => {
    await assert.rejects(
      runTool("code-review-steps-no-such-binary", [], options()),
      (error: unknown) => {
        assert.ok(error instanceof AnalyzerUnavailableError);
        assert.equal(error.analyzer, "FakeLint");
        assert.match(error.message, /Instálalo con brew install fakelint\./u);
        return true;
      },
    );
  });

  test("does not fall back to Docker when Docker is turned off", async (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "off" });

    await assert.rejects(
      runTool("code-review-steps-no-such-binary", [], options({ docker: { image: "fake/lint:1" } })),
      AnalyzerUnavailableError,
    );
  });
});

describe("parseJson", () => {
  test("parses the report of the tool", () => {
    assert.deepEqual(parseJson<{ files: number[] }>('{"files":[1]}', "PMD"), { files: [1] });
  });

  test("names the analyzer whose report could not be read", () => {
    assert.throws(() => parseJson("not json", "PMD"), (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.equal(error.message, "No se pudo interpretar el informe de PMD como JSON.");
      return true;
    });
  });

  test("rejects an empty report instead of returning undefined", () => {
    assert.throws(() => parseJson("", "Ruff"), UserFacingError);
  });
});
