import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import { DOCKER_ENV_VAR } from "../src/analysis/docker.js";
import { analyzePullRequest } from "../src/static-analysis.js";
import { stubEnv } from "./helpers/env.js";
import { createTempRepo, type TempRepo } from "./helpers/repo.js";

const RANGE = "HEAD~1...HEAD";
const BASE = "HEAD~1";

async function repoWithBase(
  t: { after(fn: () => unknown): void },
  files: Record<string, string>,
): Promise<TempRepo> {
  const repo = await createTempRepo();

  t.after(() => repo.cleanup());

  for (const [path, content] of Object.entries(files)) {
    await repo.write(path, content);
  }

  await repo.commit("base");

  return repo;
}

describe("analyzePullRequest", () => {
  test("reports as unanalyzed the files no analyzer covers", async (t) => {
    const repo = await repoWithBase(t, { "docs/guia.md": "uno\n" });

    await repo.write("docs/guia.md", "dos\n");
    await repo.commit("cambia la guía");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["docs/guia.md"]);

    assert.deepEqual(analysis, {
      tools: [],
      skipped: [],
      findingsByFile: new Map(),
      unanalyzed: ["docs/guia.md"],
    });
  });

  test("does not lose a file whose path carries spaces or non-ASCII characters", async (t) => {
    // git quotes such paths unless it is asked not to; a quoted path matches
    // none of the paths of the pull request, and the file falls off the review.
    const repo = await repoWithBase(t, { "docs/año de gracia.md": "uno\n" });

    await repo.write("docs/año de gracia.md", "dos\n");
    await repo.commit("cambia la guía");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["docs/año de gracia.md"]);

    assert.deepEqual(analysis.unanalyzed, ["docs/año de gracia.md"]);
  });

  test("leaves out a file the pull request deleted: it is not there to analyze", async (t) => {
    const repo = await repoWithBase(t, { "docs/guia.md": "uno\n", "docs/otra.md": "uno\n" });

    await rm(join(repo.dir, "docs/guia.md"));
    await repo.write("docs/otra.md", "dos\n");
    await repo.commit("borra la guía");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["docs/guia.md", "docs/otra.md"]);

    assert.deepEqual(analysis.unanalyzed, ["docs/otra.md"]);
  });

  test("plans the analyzer of the language, whether it runs or is reported as missing", async (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "off" });

    const repo = await repoWithBase(t, { "src/Order.java": "class Order {}\n" });

    await repo.write("src/Order.java", "class Order { int x; }\n");
    await repo.commit("cambia Order");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["src/Order.java"]);

    // Whether PMD is installed on this machine is not the point: the file was
    // claimed, so it must not end up in the list nobody looked at.
    const reached = [...analysis.tools, ...analysis.skipped.map((entry) => entry.tool)];

    assert.ok(reached.includes("PMD"), `PMD was neither run nor skipped: ${reached.join(", ")}`);
    assert.deepEqual(analysis.unanalyzed, []);
  });

  test("says why an analyzer was skipped, so a missing tool is visible", async (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "off" });

    const repo = await repoWithBase(t, { "src/Order.java": "class Order {}\n" });

    await repo.write("src/Order.java", "class Order { int x; }\n");
    await repo.commit("cambia Order");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["src/Order.java"]);

    for (const entry of analysis.skipped) {
      assert.ok(entry.reason.trim().length > 0, `${entry.tool} was skipped with no reason`);
    }
  });

  test("separates what was analyzed from what nobody looked at", async (t) => {
    stubEnv(t, { [DOCKER_ENV_VAR]: "off" });

    const repo = await repoWithBase(t, { "src/Order.java": "class Order {}\n", "docs/guia.md": "uno\n" });

    await repo.write("src/Order.java", "class Order { int x; }\n");
    await repo.write("docs/guia.md", "dos\n");
    await repo.commit("cambia los dos");

    const analysis = await analyzePullRequest(repo.dir, BASE, RANGE, ["src/Order.java", "docs/guia.md"]);

    assert.deepEqual(analysis.unanalyzed, ["docs/guia.md"]);
  });
});
