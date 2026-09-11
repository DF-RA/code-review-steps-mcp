import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALL_ANALYZERS,
  CROSS_LANGUAGE_ANALYZERS,
  NATIVE_ANALYZERS,
  planAnalysis,
} from "../../src/analysis/registry.js";

/** The plan keyed by analyzer name, which is what the assertions care about. */
function planByName(files: string[]): Record<string, string[]> {
  return Object.fromEntries(
    [...planAnalysis(files)].map(([analyzer, matched]) => [analyzer.name, matched]),
  );
}

describe("planAnalysis", () => {
  test("plans nothing when there are no files", () => {
    assert.equal(planAnalysis([]).size, 0);
  });

  test("plans nothing when no native analyzer claims anything", () => {
    // Semgrep only runs on top of what a native analyzer claimed, so a PR of
    // lock files and images is not scanned at all.
    assert.equal(planAnalysis(["pnpm-lock.yaml", "docs/logo.png", "README.md"]).size, 0);
  });

  test("gives each native analyzer only the extensions it understands", () => {
    const plan = planByName(["Main.java", "app.ts", "main.go", "script.py", "Main.kt"]);

    assert.deepEqual(plan["PMD"], ["Main.java"]);
    assert.deepEqual(plan["ESLint"], ["app.ts"]);
    assert.deepEqual(plan["golangci-lint"], ["main.go"]);
    assert.deepEqual(plan["Ruff"], ["script.py"]);
    assert.deepEqual(plan["detekt"], ["Main.kt"]);
  });

  test("gives the cross-language analyzer everything a native one claimed, and nothing else", () => {
    const plan = planByName(["Main.java", "app.ts", "pnpm-lock.yaml", "docs/logo.png"]);

    assert.deepEqual(plan["Semgrep"], ["Main.java", "app.ts"]);
  });

  test("matches the extension case-insensitively", () => {
    assert.deepEqual(planByName(["Main.JAVA"])["PMD"], ["Main.JAVA"]);
  });

  test("ignores a file with no extension, and one whose name is only a dot suffix", () => {
    assert.equal(planAnalysis(["Makefile", ".gitignore"]).size, 0);
  });

  test("does not confuse a dot in a directory with the extension of the file", () => {
    assert.equal(planAnalysis(["src/v1.2/Makefile"]).size, 0);
  });

  test("leaves out an analyzer that matched no file", () => {
    assert.deepEqual(Object.keys(planByName(["app.ts"])).sort(), ["ESLint", "Semgrep"]);
  });
});

describe("the analyzer registry", () => {
  test("is the natives plus the cross-language ones, with no duplicates", () => {
    assert.deepEqual(ALL_ANALYZERS, [...NATIVE_ANALYZERS, ...CROSS_LANGUAGE_ANALYZERS]);
    assert.equal(new Set(ALL_ANALYZERS.map((analyzer) => analyzer.name)).size, ALL_ANALYZERS.length);
  });

  test("declares a baseline strategy and a name for every analyzer", () => {
    for (const analyzer of ALL_ANALYZERS) {
      assert.ok(analyzer.name.length > 0);
      assert.ok(["double-pass", "changed-lines"].includes(analyzer.baseline));
    }
  });

  test("has no two native analyzers claiming the same extension", () => {
    const seen = new Set<string>();

    for (const analyzer of NATIVE_ANALYZERS) {
      for (const extension of analyzer.extensions) {
        assert.ok(!seen.has(extension), `${extension} is claimed twice`);
        seen.add(extension);
      }
    }
  });

  test("declares the extensions lowercase, which is what the matching assumes", () => {
    for (const analyzer of NATIVE_ANALYZERS) {
      for (const extension of analyzer.extensions) {
        assert.equal(extension, extension.toLowerCase());
        assert.ok(extension.startsWith("."), `${extension} should start with a dot`);
      }
    }
  });
});
