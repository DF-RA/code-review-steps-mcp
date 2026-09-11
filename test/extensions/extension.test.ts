import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";

import {
  EXTENSIONS_DIR_ENV_VAR,
  extensionsDir,
  loadExtensions,
  reviewGuidance,
  taskTracker,
} from "../../src/extensions/extension.js";
import { stubEnv } from "../helpers/env.js";

/** A directory of extension files, pointed at by the environment variable. */
async function extensionsIn(t: TestContext, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "code-review-steps-extensions-"));

  t.after(() => rm(dir, { recursive: true, force: true }));
  stubEnv(t, { [EXTENSIONS_DIR_ENV_VAR]: dir });

  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }

  return dir;
}

describe("extensionsDir", () => {
  test("defaults to the directory under the home one", (t) => {
    stubEnv(t, { [EXTENSIONS_DIR_ENV_VAR]: undefined });

    assert.match(extensionsDir(), /\.code-review-steps\/extensions$/u);
  });

  test("takes the configured one, trimmed", (t) => {
    stubEnv(t, { [EXTENSIONS_DIR_ENV_VAR]: "  /etc/crs  " });

    assert.equal(extensionsDir(), "/etc/crs");
  });
});

describe("loadExtensions", () => {
  test("returns nothing when the directory is not there", async (t) => {
    stubEnv(t, { [EXTENSIONS_DIR_ENV_VAR]: join(tmpdir(), "code-review-steps-no-such-dir") });

    assert.deepEqual(await loadExtensions(), []);
  });

  test("reads the .json files of the directory", async (t) => {
    await extensionsIn(t, {
      "acme.json": JSON.stringify({ name: "acme", description: "Convenciones de Acme" }),
    });

    assert.deepEqual(await loadExtensions(), [{ name: "acme", description: "Convenciones de Acme" }]);
  });

  test("reads them in a stable order, so the tracker that wins is predictable", async (t) => {
    await extensionsIn(t, {
      "zeta.json": JSON.stringify({ name: "zeta" }),
      "alpha.json": JSON.stringify({ name: "alpha" }),
      "media.json": JSON.stringify({ name: "media" }),
    });

    assert.deepEqual((await loadExtensions()).map((extension) => extension.name), [
      "alpha",
      "media",
      "zeta",
    ]);
  });

  test("ignores anything that is not a .json file", async (t) => {
    await extensionsIn(t, {
      "acme.json": JSON.stringify({ name: "acme" }),
      "notas.txt": "no soy una extensión",
      "acme.json.bak": JSON.stringify({ name: "vieja" }),
    });

    assert.deepEqual((await loadExtensions()).map((extension) => extension.name), ["acme"]);
  });

  test("names an extension after its file when it declares no name", async (t) => {
    await extensionsIn(t, { "equipo-plataforma.json": JSON.stringify({ description: "d" }) });

    assert.deepEqual((await loadExtensions()).map((extension) => extension.name), ["equipo-plataforma"]);
  });

  test("skips a broken extension and keeps the rest", async (t) => {
    await extensionsIn(t, {
      "buena.json": JSON.stringify({ name: "buena" }),
      "rota.json": "{ esto no es json",
    });

    // The warning goes to stderr, where it cannot corrupt the stdio protocol.
    t.mock.method(console, "error", () => undefined);

    assert.deepEqual((await loadExtensions()).map((extension) => extension.name), ["buena"]);
    assert.equal((console.error as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);
  });

  test("re-reads the directory on every call, so an edit takes effect at once", async (t) => {
    const dir = await extensionsIn(t, { "acme.json": JSON.stringify({ name: "acme" }) });

    assert.equal((await loadExtensions()).length, 1);

    await writeFile(join(dir, "otra.json"), JSON.stringify({ name: "otra" }), "utf8");

    assert.equal((await loadExtensions()).length, 2);
  });
});

describe("taskTracker", () => {
  test("is undefined when no extension declares one", async (t) => {
    await extensionsIn(t, { "acme.json": JSON.stringify({ name: "acme" }) });

    assert.equal(await taskTracker(), undefined);
  });

  test("is the one of the first extension that declares it", async (t) => {
    await extensionsIn(t, {
      "alpha.json": JSON.stringify({ name: "alpha" }),
      "beta.json": JSON.stringify({ name: "beta", taskTracker: { name: "Jira" } }),
      "gamma.json": JSON.stringify({ name: "gamma", taskTracker: { name: "Linear" } }),
    });

    assert.deepEqual(await taskTracker(), { name: "Jira" });
  });

  test("carries the pattern and the instructions across", async (t) => {
    const tracker = {
      name: "Jira",
      codePattern: "[A-Z]+-\\d+",
      codeExample: "PROJ-1234",
      instructions: "Búscalo con el MCP de Jira.",
    };

    await extensionsIn(t, { "acme.json": JSON.stringify({ name: "acme", taskTracker: tracker }) });

    assert.deepEqual(await taskTracker(), tracker);
  });
});

describe("reviewGuidance", () => {
  test("is empty when no extension contributes any", async (t) => {
    await extensionsIn(t, { "acme.json": JSON.stringify({ name: "acme" }) });

    assert.deepEqual(await reviewGuidance(), []);
  });

  test("collects the guidance of every extension, unlike the tracker", async (t) => {
    await extensionsIn(t, {
      "alpha.json": JSON.stringify({ name: "alpha", reviewGuidance: "  Mira los tests.  " }),
      "beta.json": JSON.stringify({ name: "beta", reviewGuidance: "Mira los logs." }),
    });

    assert.deepEqual(await reviewGuidance(), ["Mira los tests.", "Mira los logs."]);
  });

  test("drops guidance that is empty or only whitespace", async (t) => {
    await extensionsIn(t, {
      "alpha.json": JSON.stringify({ name: "alpha", reviewGuidance: "   " }),
      "beta.json": JSON.stringify({ name: "beta", reviewGuidance: "Mira los logs." }),
    });

    assert.deepEqual(await reviewGuidance(), ["Mira los logs."]);
  });
});
