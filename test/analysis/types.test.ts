import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AnalyzerUnavailableError,
  SEVERITIES,
  fingerprint,
  severityFromPriority,
  toRelative,
  type Finding,
} from "../../src/analysis/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    tool: "PMD",
    path: "src/Main.java",
    line: 10,
    endLine: 10,
    rule: "UnusedImport",
    severity: "medium",
    message: "Unused import",
    ...overrides,
  };
}

describe("fingerprint", () => {
  test("ignores the line, so a finding that moved is still the same one", () => {
    assert.equal(fingerprint(finding({ line: 10 })), fingerprint(finding({ line: 240 })));
  });

  test("separates findings that differ in tool, path, rule or message", () => {
    const base = fingerprint(finding());

    for (const overrides of [
      { tool: "Semgrep" },
      { path: "src/Other.java" },
      { rule: "UnusedVariable" },
      { message: "Something else" },
    ]) {
      assert.notEqual(fingerprint(finding(overrides)), base);
    }
  });

  test("does not let a field bleed into the next one", () => {
    // Without a separator, ("a", "bc") and ("ab", "c") would collide.
    assert.notEqual(
      fingerprint(finding({ tool: "a", path: "bc" })),
      fingerprint(finding({ tool: "ab", path: "c" })),
    );
  });
});

describe("severityFromPriority", () => {
  test("maps the PMD 1..5 scale onto the three severities", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(severityFromPriority), [
      "high",
      "high",
      "medium",
      "low",
      "low",
    ]);
  });

  test("keeps a priority below the scale on the high end", () => {
    assert.equal(severityFromPriority(0), "high");
  });
});

describe("toRelative", () => {
  test("strips the clone it was analyzed in", () => {
    assert.equal(toRelative("/home/me/repo/src/Main.java", "/home/me/repo"), "src/Main.java");
  });

  test("strips the container workdir, where a dockerized analyzer reports from", () => {
    assert.equal(toRelative("/src/Main.java", "/home/me/repo"), "Main.java");
  });

  test("accepts a cwd with a trailing slash", () => {
    assert.equal(toRelative("/home/me/repo/src/Main.java", "/home/me/repo/"), "src/Main.java");
  });

  test("leaves a path that is already relative alone", () => {
    assert.equal(toRelative("src/Main.java", "/home/me/repo"), "src/Main.java");
  });

  test("does not cut a sibling directory that merely shares the prefix", () => {
    assert.equal(toRelative("/home/me/repo-old/src/Main.java", "/home/me/repo"), "/home/me/repo-old/src/Main.java");
  });
});

describe("AnalyzerUnavailableError", () => {
  test("carries the analyzer and the hint into a message the user can act on", () => {
    const error = new AnalyzerUnavailableError("PMD", "Instálalo con brew install pmd.");

    assert.equal(error.analyzer, "PMD");
    assert.equal(error.hint, "Instálalo con brew install pmd.");
    assert.equal(error.name, "AnalyzerUnavailableError");
    assert.match(error.message, /^PMD no está disponible\. Instálalo con brew install pmd\.$/u);
    assert.ok(error instanceof Error);
  });
});

describe("SEVERITIES", () => {
  test("is ordered from worst to mildest: analyzePullRequest sorts by this order", () => {
    assert.deepEqual([...SEVERITIES], ["high", "medium", "low"]);
  });
});
